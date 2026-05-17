import React, { useState } from 'react';

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
          {isVisible ? 'Скрыть' : 'Показать'}
        </button>
      </div>
    </label>
  );
}
