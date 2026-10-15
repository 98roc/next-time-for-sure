"""本机构建、通过 SSH 上传并执行 Docker 部署；配置不进入镜像或日志。"""
import argparse
import getpass
import gzip
import hashlib
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.cache' / 'deploy-tools'))
import paramiko

NODE_IMAGE = 'node:24.21.0-alpine'
WEB_IMAGE = 'nginx:1.30.6'
REQUIRED = ['DEPLOY_HOST', 'DEPLOY_SSH_PORT', 'DEPLOY_USER', 'DEPLOY_PATH', 'HTTP_BIND', 'HTTP_PORT',
            'DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE', 'API_HOST', 'API_PORT', 'NODE_ENV']


def configuration(path):
    """解析字面量键值，拒绝换行和危险路径，不执行配置中的任何代码。"""
    values = {}
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or key in values or not re.fullmatch(r'[A-Z_]+', key):
            raise RuntimeError('Invalid or duplicate deployment configuration key')
        values[key] = value
    if any(not values.get(key) for key in REQUIRED):
        raise RuntimeError('Deployment configuration has missing required fields')
    if values['DB_DATABASE'] != 'next_time_for_sure' or values['NODE_ENV'] != 'production':
        raise RuntimeError('Only the dedicated production database/environment is allowed')
    if not re.fullmatch(r'/(?:[A-Za-z0-9_-]+/)+next-time-for-sure', values['DEPLOY_PATH']):
        raise RuntimeError('Deployment path must be an absolute path ending in /next-time-for-sure, without dot segments')
    if values['API_HOST'] != '0.0.0.0' or values['API_PORT'] != '3100':
        raise RuntimeError('Container API must bind 0.0.0.0:3100; it is not published on the host')
    for key in ['HTTP_PORT', 'DB_PORT', 'DEPLOY_SSH_PORT']:
        if not values[key].isdigit() or not 1 <= int(values[key]) <= 65535:
            raise RuntimeError('Invalid port: ' + key)
    if not re.fullmatch(r'[0-9.]+', values['HTTP_BIND']):
        raise RuntimeError('HTTP_BIND must be an IPv4 address')
    return values


def run(arguments, **kwargs):
    """原样传递参数并在首个失败处停止；不拼接本地 shell 命令。"""
    subprocess.run([str(value) for value in arguments], cwd=ROOT, check=True, **kwargs)


def pnpm(*arguments):
    run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ROOT / 'scripts/pnpm.ps1', *arguments])


def ensure_image(image):
    """优先使用已缓存镜像；Docker 拉取失败时通过本机 HTTPS 路径下载官方层。"""
    if subprocess.run(['docker', 'image', 'inspect', image], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        return
    if subprocess.run(['docker', 'pull', image]).returncode == 0:
        return
    repository, tag = image.split(':')
    cache = ROOT / '.cache/deploy-downloads'
    archive = cache / (repository + '-' + tag + '.tar.gz')
    try:
        run([sys.executable, ROOT / 'scripts/deployment/fetch-image.py', repository, tag, archive])
        run(['docker', 'load', '-i', archive])
    finally:
        archive.unlink(missing_ok=True)


def pack_context(context, archive):
    """将 Windows junction 转为 Linux 相对符号链接，避免循环展开与打包外部文件。"""
    root = context.resolve()
    # Docker CLI 的 stdin 类型探测不能识别首条记录为 PAX 扩展头的归档。
    with tarfile.open(archive, 'w', dereference=False, format=tarfile.GNU_FORMAT) as output:
        def add(path):
            name = path.relative_to(root).as_posix()
            if path.is_symlink() or path.is_junction():
                target = path.resolve()
                # pnpm legacy deploy 留下包自身的 workspace 链接，改为当前导出包。
                if target == ROOT / 'apps/api':
                    target = root / 'api'
                if not target.is_relative_to(root):
                    raise RuntimeError('Deployment dependency links outside the isolated package')
                entry = tarfile.TarInfo(name)
                entry.type = tarfile.SYMTYPE
                entry.linkname = pathlib.Path(os.path.relpath(target, path.parent)).as_posix()
                entry.mode = 0o777
                output.addfile(entry)
            else:
                # 本地环境和私钥永不进入构建上下文，包括包目录下未来新增的配置。
                if path.name.startswith('.env') or path.name.endswith(('.local', '.pem', '.key', '.p12', '.pfx')) or path.name in ['.npmrc', '.git']:
                    return
                output.add(path, arcname=name, recursive=False)
                if path.is_dir():
                    for child in sorted(path.iterdir()):
                        add(child)
        for child in sorted(root.iterdir()):
            add(child)


def build_images(directory, release):
    """仅打包 API 的生产依赖与前端产物；不携带源码、开发配置或桌面程序。"""
    for package in ['@ntfs/contracts', '@ntfs/ui', '@ntfs/api', '@ntfs/web']:
        pnpm('--filter', package, 'build')
    context = directory / 'context'
    context.mkdir()
    api = context / 'api'
    pnpm('--filter', '@ntfs/api', '--prod', 'deploy', '--legacy', str(api))
    for item in api.iterdir():
        if item.name not in ['dist', 'node_modules', 'package.json']:
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()
    contracts_source = api / 'node_modules/@ntfs/contracts/src'
    if contracts_source.exists():
        resolved = contracts_source.resolve()
        if not resolved.is_relative_to(api.resolve()):
            raise RuntimeError('Workspace export must contain its own contracts package')
        shutil.rmtree(resolved)
    shutil.copytree(ROOT / 'apps/web/dist', context / 'web')
    for name in ['Dockerfile.api', 'Dockerfile.web', 'nginx.conf']:
        shutil.copyfile(ROOT / 'deploy' / name, context / name)
    shutil.copyfile(ROOT / 'pnpm-workspace.yaml', context / 'pnpm-workspace.yaml')

    # 保留依赖图，Linux 镜像不保留 Windows 的绝对路径。
    archive = directory / 'context.tar'
    pack_context(context, archive)
    environment = {**os.environ, 'DOCKER_BUILDKIT': '1'}
    for component in ['api', 'web']:
        with archive.open('rb') as source:
            run(['docker', 'build', '--pull=false', '-f', 'Dockerfile.' + component,
                 '-t', 'ntfs-' + component + ':' + release, '-'], stdin=source, env=environment)
    raw = directory / 'images.tar'
    run(['docker', 'save', '-o', raw, 'ntfs-api:' + release, 'ntfs-web:' + release])
    result = directory / 'images.tar.gz'
    with raw.open('rb') as source, gzip.open(result, 'wb', compresslevel=3) as destination:
        shutil.copyfileobj(source, destination)
    raw.unlink()
    return result


def remote(client, command):
    """逐段读取两条流，长操作持续输出且避免 SSH 缓冲区死锁。"""
    channel = client.get_transport().open_session()
    channel.exec_command(command)
    deadline = time.monotonic() + 1800
    while True:
        for ready, receive, stream in [(channel.recv_ready, channel.recv, sys.stdout),
                                       (channel.recv_stderr_ready, channel.recv_stderr, sys.stderr)]:
            if ready():
                stream.write(receive(65536).decode('utf-8', errors='replace'))
                stream.flush()
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        if time.monotonic() > deadline:
            channel.close()
            raise RuntimeError('Remote operation timed out; inspect the server before retrying')
        time.sleep(0.1)
    if channel.recv_exit_status() != 0:
        raise RuntimeError('Remote operation failed')


def upload(sftp, local, target, mode=0o600):
    """先上传临时文件再改名，避免读取到半份配置或脚本。"""
    partial = target + '.upload-' + uuid.uuid4().hex[:8]
    try:
        last_report = 0
        def progress(transferred, total):
            nonlocal last_report
            if transferred - last_report >= 32 * 1024 * 1024:
                print('Upload: ' + str(transferred // (1024 * 1024)) + '/' + str(total // (1024 * 1024)) + ' MiB', flush=True)
                last_report = transferred
        sftp.put(str(local), partial, callback=progress)
        sftp.chmod(partial, mode)
        sftp.posix_rename(partial, target)
    finally:
        try:
            sftp.remove(partial)
        except FileNotFoundError:
            pass


def write_configs(directory, values):
    """生成不含 SSH 密码的容器环境文件和 MySQL 客户端配置。"""
    environment = directory / 'production.env'
    environment.write_text(''.join(key + '=' + value + '\n' for key, value in values.items()
                                   if key.startswith(('DB_', 'API_')) or key == 'NODE_ENV'), encoding='utf-8', newline='\n')
    def quote(value):
        return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'
    mysql = directory / 'mysql.cnf'
    mysql.write_text('[client]\n' + ''.join(key + '=' + quote(values[field]) + '\n' for key, field in
                     [('host', 'DB_HOST'), ('port', 'DB_PORT'), ('user', 'DB_USERNAME'), ('password', 'DB_PASSWORD')])
                     + 'default-character-set=utf8mb4\n', encoding='utf-8', newline='\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['Prepare', 'Check', 'Validate', 'Deploy', 'InitAdmin'])
    parser.add_argument('--config', type=pathlib.Path, default=ROOT / '.deploy.production.local')
    args = parser.parse_args()
    values = configuration(args.config)
    base = values['DEPLOY_PATH']
    release = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6]
    cache = ROOT / '.cache/deployment'
    cache.mkdir(parents=True, exist_ok=True)
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    # 未知或变化的主机密钥必须由标准 SSH 首次核验，绝不静默忽略变化。
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    password = values.get('DEPLOY_PASSWORD') or None
    if password is None and not os.environ.get('SSH_AUTH_SOCK'):
        password = getpass.getpass('SSH password (empty for key authentication): ') or None
    client.connect(values['DEPLOY_HOST'], port=int(values['DEPLOY_SSH_PORT']), username=values['DEPLOY_USER'],
                   password=password, timeout=15, auth_timeout=20)
    try:
        command = 'bash ' + shlex.quote(base + '/deploy.sh')
        command += ' ' + ' '.join(shlex.quote(value) for value in [args.action.lower(), base, release, values['HTTP_BIND'], values['HTTP_PORT']])
        if args.action in ['Check', 'InitAdmin']:
            remote(client, command)
            return
        run(['docker', 'info'], stdout=subprocess.DEVNULL)
        ensure_image(NODE_IMAGE)
        ensure_image(WEB_IMAGE)
        with tempfile.TemporaryDirectory(prefix='ntfs-', dir=cache) as scratch:
            directory = pathlib.Path(scratch)
            write_configs(directory, values)
            server_script = directory / 'server.sh'
            server_script.write_text((ROOT / 'scripts/deployment/server.sh').read_text(encoding='utf-8'), encoding='utf-8', newline='\n')
            remote(client, 'umask 077; mkdir -p ' + ' '.join(shlex.quote(base + suffix) for suffix in ['', '/shared', '/runtime', '/releases', '/backups']))
            with client.open_sftp() as sftp:
                upload(sftp, server_script, base + '/deploy.sh', 0o700)
                if args.action == 'Prepare':
                    # 环境准备不可覆写已有线上凭据。
                    for name in ['production.env', 'mysql.cnf']:
                        try:
                            sftp.stat(base + '/shared/' + name)
                        except FileNotFoundError:
                            upload(sftp, directory / name, base + '/shared/' + name)
                    archive = directory / 'runtime.tar'
                    run(['docker', 'save', '-o', archive, NODE_IMAGE, WEB_IMAGE])
                    upload(sftp, archive, base + '/runtime/runtime.tar')
                else:
                    archive = build_images(directory, release)
                    destination = base + '/releases/' + release
                    sftp.mkdir(destination, 0o700)
                    upload(sftp, archive, destination + '/images.tar.gz')
                    for name in ['production.env', 'mysql.cnf']:
                        upload(sftp, directory / name, destination + '/' + name)
                    (directory / 'images.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  images.tar.gz\n', encoding='ascii', newline='\n')
                    upload(sftp, directory / 'images.sha256', destination + '/images.sha256')
            remote(client, command)
    finally:
        client.close()
        if args.action == 'Validate':
            # 验证镜像不作为发布产物保留；删除精确版本标签，不清理其他镜像或缓存。
            subprocess.run(['docker', 'rmi', 'ntfs-api:' + release, 'ntfs-web:' + release],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # 不输出参数/连接串/凭据；远端脚本已经报告可操作的失败阶段。
        print('Deployment stopped (' + type(error).__name__ + '). Check the preceding stage and server state.', file=sys.stderr)
        sys.exit(1)
