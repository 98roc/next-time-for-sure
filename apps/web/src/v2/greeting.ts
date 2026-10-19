const shanghaiClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** 按北京时间的分钟边界问候，与设备时区无关，不改变服务器业务日期。 */
export function timeGreeting(now = new Date()): string {
  const parts = shanghaiClock.formatToParts(now);
  const minutes = Number(parts.find((part) => part.type === 'hour')?.value) * 60 + Number(parts.find((part) => part.type === 'minute')?.value);
  if (minutes < 360 || minutes >= 1320) return '夜深了';
  if (minutes < 570) return '早上好';
  if (minutes < 720) return '上午好';
  if (minutes < 840) return '中午好';
  if (minutes < 1080) return '下午好';
  return '晚上好';
}

/** 每次进入页面随机选择一句；空列表隐藏，允许再次抽中同一句。 */
export function pickTeamMessage(messages: readonly string[]): string | null {
  return messages[Math.floor(Math.random() * messages.length)] ?? null;
}
