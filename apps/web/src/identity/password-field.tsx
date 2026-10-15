import { useId, useState } from 'react';

/** 密码输入独立控制可见性，切换时不提交表单，不将明文写入持久化存储。 */
export function PasswordField({ label, value, onChange, autoComplete, hint, invalid = false }: {
  label: string; value: string; onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password'; hint?: string; invalid?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return <div className="password-field"><label htmlFor={id}>{label}</label><div className="password-input">
    <input id={id} name={id} type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} required maxLength={128} minLength={autoComplete === 'new-password' ? 12 : undefined} autoComplete={autoComplete} aria-invalid={invalid} aria-describedby={hint ? id + '-hint' : undefined} />
    <button type="button" aria-label={(visible ? '隐藏' : '显示') + label} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? '隐藏' : '显示'}</button>
  </div>{hint && <small id={id + '-hint'}>{hint}</small>}</div>;
}
