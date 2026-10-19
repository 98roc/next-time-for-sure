import { useEffect, useState } from 'react';
import { pickTeamMessage, timeGreeting } from './greeting';

/** 问候按分钟更新；标语仅在页面挂载或当前句被移除时抽取，轮询与任务操作不换句。 */
export function PersonalWelcome({ name, messages }: { name: string; messages: string[] }) {
  const [greeting, setGreeting] = useState(timeGreeting);
  const [selected, setSelected] = useState(() => pickTeamMessage(messages));
  useEffect(() => {
    // 对齐分钟边界，包含 09:30；从后台恢复时立即校准，不依赖被浏览器节流的计时器。
    let timer: ReturnType<typeof setTimeout>;
    const update = () => { clearTimeout(timer); setGreeting(timeGreeting()); timer = setTimeout(update, 60000 - Date.now() % 60000); };
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  useEffect(() => {
    if (selected === null || !messages.includes(selected)) setSelected(pickTeamMessage(messages));
  }, [messages, selected]);
  return <div><h1>{greeting}，{name}</h1>{selected !== null && messages.includes(selected) && <p id="mw-team-phrase">{selected}</p>}</div>;
}
