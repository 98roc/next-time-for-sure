"""通过本机代理下载 Docker Hub 官方 amd64 镜像，校验摘要并生成旧 Docker 可读归档。"""
import argparse
import gzip
import hashlib
import io
import json
import pathlib
import shutil
import tarfile
import tempfile
import time
import urllib.request


def download(request):
    """对临时网络失败做有限重试，始终保留 TLS 校验。"""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except (OSError, urllib.error.URLError):
            if attempt == 2:
                raise
            time.sleep(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository', choices=['node', 'nginx'])
    parser.add_argument('tag')
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    repository = 'library/' + args.repository
    token_url = 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:' + repository + ':pull'
    token = json.loads(download(token_url))['token']
    headers = {'Authorization': 'Bearer ' + token, 'Accept': ', '.join([
        'application/vnd.oci.image.index.v1+json', 'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.docker.distribution.manifest.list.v2+json', 'application/vnd.docker.distribution.manifest.v2+json'])}

    def fetch(path):
        request = urllib.request.Request('https://registry-1.docker.io/v2/' + repository + '/' + path, headers=headers)
        return download(request)

    def checked(data, digest):
        if 'sha256:' + hashlib.sha256(data).hexdigest() != digest:
            raise RuntimeError('Image digest mismatch')
        return data

    # 只选 Linux amd64；忽略签名/证明等非运行清单。
    index = json.loads(fetch('manifests/' + args.tag))
    selected = next(item for item in index['manifests'] if item.get('platform') == {'architecture': 'amd64', 'os': 'linux'})
    manifest = json.loads(checked(fetch('manifests/' + selected['digest']), selected['digest']))
    config = checked(fetch('blobs/' + manifest['config']['digest']), manifest['config']['digest'])
    diff_ids = json.loads(config)['rootfs']['diff_ids']
    args.output.parent.mkdir(parents=True, exist_ok=True)

    # 旧引擎不认识 OCI 索引；转换成 docker save 的 manifest.json + layer.tar 格式。
    with tempfile.TemporaryDirectory(prefix='ntfs-image-', dir=args.output.parent) as directory:
        root = pathlib.Path(directory)
        config_name = manifest['config']['digest'].split(':')[1] + '.json'
        (root / config_name).write_bytes(config)
        layers = []
        for number, layer in enumerate(manifest['layers']):
            data = checked(fetch('blobs/' + layer['digest']), layer['digest'])
            layer_name = str(number) + '/layer.tar'
            target = root / layer_name
            target.parent.mkdir()
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as source, target.open('wb') as destination:
                shutil.copyfileobj(source, destination)
            digest = hashlib.sha256()
            with target.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            if 'sha256:' + digest.hexdigest() != diff_ids[number]:
                raise RuntimeError('Uncompressed layer digest mismatch')
            layers.append(layer_name)
            print('Verified layer', number + 1, '/', len(manifest['layers']), flush=True)
        (root / 'manifest.json').write_text(json.dumps([{'Config': config_name, 'RepoTags': [args.repository + ':' + args.tag], 'Layers': layers}]), encoding='utf-8')
        with tarfile.open(args.output, 'w:gz') as archive:
            archive.add(root / config_name, arcname=config_name)
            archive.add(root / 'manifest.json', arcname='manifest.json')
            for layer_name in layers:
                archive.add(root / layer_name, arcname=layer_name)
    print(args.repository + ':' + args.tag + ' ' + selected['digest'])


if __name__ == '__main__':
    main()
