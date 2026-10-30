import { useSearchParams } from 'react-router-dom';
import { useWorkspace } from './workspace';

/** 团队选择放在页面标题右侧；仅超管有多个团队时展示，切换清除旧项目定位。 */
export function TeamFilter() {
  const { user, data, selectTeam } = useWorkspace(), [, setParams] = useSearchParams();
  const teams = data.teams ?? [];
  if (!user.isSuperAdmin || teams.length < 2) return null;
  return <label className="v2-team-filter"><select aria-label="查看团队" value={data.team?.id ?? ''} onChange={(event) => { setParams({}); selectTeam(event.target.value); }}>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>;
}
