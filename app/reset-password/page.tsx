import { Suspense } from 'react';
import ResetPasswordForm from './ResetPasswordForm';

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100dvh',
            background: '#0a0f1e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#8b949e',
          }}
        >
          Loading…
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
