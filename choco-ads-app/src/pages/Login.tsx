import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button, Input } from "@/components/ui";
import { isConfigured } from "@/lib/supabase";

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-brand-500" />
          <div>
            <h1 className="text-base font-semibold">광고 성과 콘솔</h1>
            <p className="text-xs text-ink-faint">초코펫하우스</p>
          </div>
        </div>

        {!isConfigured && (
          <div className="mb-4 rounded-md border border-warn/30 bg-warn-soft p-3 text-xs text-warn">
            Supabase 연결 정보가 없습니다. <code>.env</code> 에 VITE_SUPABASE_URL 과
            VITE_SUPABASE_ANON_KEY 를 넣고 다시 실행하세요.
          </div>
        )}

        <form onSubmit={submit} className="card space-y-3 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted" htmlFor="email">
              이메일
            </label>
            <Input id="email" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted" htmlFor="password">
              비밀번호
            </label>
            <Input id="password" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          {error && (
            <p className="rounded bg-bad-soft px-2.5 py-2 text-xs text-bad">{error}</p>
          )}

          <Button type="submit" variant="primary" className="w-full" loading={loading}>
            로그인
          </Button>
        </form>

        <p className="mt-3 text-center text-2xs text-ink-faint">
          계정은 관리자가 Supabase Authentication 에서 발급합니다.
        </p>
      </div>
    </div>
  );
}
