import { useState } from 'react';
import { api } from './api';

const DOORS = [
  { id: 'manager', label: 'מנהל' },
  { id: 'owner', label: 'בעל נכס' },
  { id: 'technician', label: 'טכנאי' },
];

const DOOR_ERROR = {
  manager: 'החשבון הזה אינו מנהל',
  owner: 'החשבון הזה אינו בעל נכס',
  technician: 'החשבון הזה אינו טכנאי',
};

function matchesDoor(user, door) {
  if (!user) return false;
  if (door === 'manager') return user.role === 'manager';
  if (door === 'technician') return user.role === 'employee';
  if (door === 'owner') return user.role === 'customer' && user.access === 'chair';
  return false;
}

export default function Login({ onEnter }) {
  const [door, setDoor] = useState('owner');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function enterDoor(user) {
    if (!matchesDoor(user, door)) {
      return api('/api/session', { method: 'DELETE' }).catch(() => {}).then(() => {
        setError(DOOR_ERROR[door] || 'החשבון הזה אינו תואם לתפקיד שנבחר');
        setBusy(false);
      });
    }
    return onEnter(user);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (usePassword) {
        const { user } = await api('/api/auth/login', {
          method: 'POST',
          body: { phone, password, door },
        });
        await enterDoor(user);
        return;
      }
      if (!codeSent) {
        const data = await api('/api/auth/otp/request', {
          method: 'POST',
          body: { phone },
        });
        setCodeSent(true);
        if (data && data.code) setCode(String(data.code));
        setBusy(false);
        return;
      }
      const { user } = await api('/api/auth/otp/verify', {
        method: 'POST',
        body: { phone, code, door },
      });
      await enterDoor(user);
    } catch (err) {
      await api('/api/session', { method: 'DELETE' }).catch(() => {});
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img className="login-mark" src="/icon-v2-192.png" alt="" width="48" height="48" />
        <h1 className="login-title">אחזקה</h1>
        <div className="door-bar" role="group" aria-label="תפקיד" data-door={door}>
          <span className="door-glide" aria-hidden="true" />
          {DOORS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === 'owner' ? 'door-owner' : undefined}
              aria-pressed={door === item.id}
              onClick={() => setDoor(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="login-fields">
          <label className="field">
            <span className="field-label">נייד</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="username"
              dir="ltr"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setCodeSent(false);
                setCode('');
              }}
            />
          </label>
          {usePassword ? (
            <label className="field">
              <span className="field-label">סיסמה</span>
              <input
                type="password"
                autoComplete="current-password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          ) : null}
          {!usePassword && codeSent ? (
            <label className="field">
              <span className="field-label">קוד</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </label>
          ) : null}
        </div>
        <div className="login-submit">
          {error ? <p className="login-error" role="alert">{error}</p> : null}
          <button type="submit" className="btn" disabled={busy}>
            {!usePassword && !codeSent ? 'שליחת קוד' : 'כניסה'}
          </button>
          <button
            type="button"
            className="login-alt"
            onClick={() => {
              setUsePassword((value) => !value);
              setError('');
              setCodeSent(false);
              setCode('');
            }}
          >
            {usePassword ? 'כניסה עם קוד' : 'כניסה עם סיסמה'}
          </button>
        </div>
      </form>
    </div>
  );
}
