import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from '@ntfs/ui';
import { fetchHealth, fetchReadiness } from '../api';

/** 第1阶段展示真实服务状态；业务入口在相应阶段完成后再开放。 */
export function FoundationPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => fetchHealth(signal) });
  const database = useQuery({ queryKey: ['readiness'], queryFn: ({ signal }) => fetchReadiness(signal) });
  const busy = health.isFetching || database.isFetching;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">▧</span><div><strong>下次一定</strong><small>Next Time, For Sure</small></div></div>
        <nav aria-label="主导航"><a href="/" aria-current="page">工程状态</a><a href="/account">账号与安全</a><a href="/organization">团队与项目</a></nav>
        <div className="sidebar-note">把安排、进展和变化<br />连接在一起。</div>
      </aside>
      <main>
        <header><div><p className="eyebrow">本地研发环境</p><h1>从一个可靠的起点开始</h1><p className="subtitle">账号、组织与权限已建立，执行与汇报能力按计划逐步交付。</p></div><StatusBadge tone="neutral">第 2 阶段</StatusBadge></header>
        <section className="status-grid" aria-label="运行状态" aria-live="polite">
          <article className="panel"><span className="eyebrow">业务服务</span><div className="panel-title"><h2>后端连接</h2><StatusBadge tone={health.isSuccess ? 'success' : 'warning'}>{health.isPending ? '检查中' : health.isSuccess ? '运行正常' : '连接失败'}</StatusBadge></div><p>{health.isError ? health.error.message : '网页、桌面和Agent将共用同一套业务接口。'}</p><small>{health.data ? `最近检查 ${new Date(health.data.time).toLocaleTimeString('zh-CN')}` : '等待后端响应'}</small></article>
          <article className="panel"><span className="eyebrow">持久化存储</span><div className="panel-title"><h2>数据库与迁移</h2><StatusBadge tone={database.isSuccess ? 'success' : 'warning'}>{database.isPending ? '检查中' : database.isSuccess ? '已就绪' : '未就绪'}</StatusBadge></div><p>{database.isError ? database.error.message : '检查数据库连接及工程基线，不自动修改数据库结构。'}</p><small>{database.isSuccess ? '迁移基线已核验' : '数据库连接与迁移需同时通过'}</small></article>
        </section>
        <div className="actions"><button disabled={busy} onClick={() => { void health.refetch(); void database.refetch(); }}>{busy ? '正在检查…' : '重新检查'}</button><a href="/api/docs" target="_blank" rel="noreferrer">查看接口文档 ↗</a></div>
        <section className="panel roadmap"><div><p className="eyebrow">接下来</p><h2>需求、任务与个人执行</h2><p>连接需求接收、团队分工和个人执行记录。</p></div><StatusBadge tone="neutral">待实施</StatusBadge></section>
        <p className="footnote">当前页面连接真实服务；不包含任务示例数据，也不代表任务、周计划或周报已经实现。</p>
      </main>
    </div>
  );
}
