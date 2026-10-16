/** 生成 UUID v4 操作标识；兼容内网 HTTP，保持后端幂等键与检查项标识格式。 */
export function createOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('当前浏览器不支持安全随机数，请升级浏览器后重试。');

  // HTTP 上仍可用 getRandomValues；设置 UUID v4 版本和变体位，不使用 Math.random 降级。
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (value, index) => {
    const byte = index === 6 ? (value & 0x0f) | 0x40 : index === 8 ? (value & 0x3f) | 0x80 : value;
    return byte.toString(16).padStart(2, '0');
  }).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
