import React, { useState } from 'react';

function EyeIcon({ closed = false }) {
  if (closed) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3 3l18 18" />
        <path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" />
        <path d="M9.88 5.09A9.7 9.7 0 0 1 12 4.86c5.25 0 8.5 4.76 9.5 7.14a12.34 12.34 0 0 1-2.22 3.3" />
        <path d="M6.53 6.53A12.06 12.06 0 0 0 2.5 12c1 2.38 4.25 7.14 9.5 7.14 1.2 0 2.3-.25 3.28-.68" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.5 12c1-2.38 4.25-7.14 9.5-7.14S20.5 9.62 21.5 12c-1 2.38-4.25 7.14-9.5 7.14S3.5 14.38 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function PasswordField({
  label,
  value,
  onChange,
  name,
  autoComplete,
  placeholder,
  minLength,
  required = false,
  disabled = false
}) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <label className="field-label password-field">
      <span>{label}</span>
      <div className="password-input-shell">
        <input
          value={value}
          onChange={onChange}
          type={isVisible ? 'text' : 'password'}
          name={name}
          autoComplete={autoComplete}
          minLength={minLength}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
        />
        <button
          type="button"
          className="ghost password-toggle-btn"
          onClick={() => setIsVisible((current) => !current)}
          aria-pressed={isVisible}
          aria-label={isVisible ? 'Скрыть пароль' : 'Показать пароль'}
          disabled={disabled}
        >
          <EyeIcon closed={!isVisible} />
        </button>
      </div>
    </label>
  );
}
