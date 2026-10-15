import { Link } from 'react-router-dom';
import type { Identity, OrganizationSnapshot } from '@ntfs/contracts';
import { EmptyState } from '../layout/empty-state';

/** 目录为空时按当前团队身份给出入口；加载失败不应被当作尚未创建。 */
export function ProjectOnboarding({ identity, organization, onCreate }: { identity: Identity; organization: OrganizationSnapshot; onCreate?: () => void }) {
  const team = organization.teams[0];
  const leader = team?.leaderId === identity.id;
  const leaderName = organization.accounts.find((account) => account.id === team?.leaderId)?.displayName;
  return <EmptyState title={leader ? '从第一个项目开始' : team ? '你还没有加入项目' : '你还没有加入团队'} description={leader ? '创建项目并指定项目经理和研发负责人，接着添加任务、安排团队分工。' : team ? `请联系${leaderName ? `团队管理员 ${leaderName}` : '团队管理员'}将你加入项目。你也可以先记录自己的私人事项。` : '请联系系统管理员加入团队。加入后即可参与项目协作。'}>
    {leader ? onCreate ? <button className="primary-button" onClick={onCreate}>＋ 创建项目</button> : <Link className="button-link primary-button" to="/work?create=project">＋ 创建项目</Link> : <Link className="button-link" to="/personal">前往我的工作</Link>}
  </EmptyState>;
}
