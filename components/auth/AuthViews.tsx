"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast, Toaster } from "sonner";
import { Loader2, Eye, EyeOff, Heart, LogIn } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UserProfile } from "@/lib/types";

export function SystemLogin({ onSuccess, onViewChange }: { onSuccess: () => Promise<void>; onViewChange: (v: any) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) {
      toast.error("يرجى إدخال اسم المستخدم وكلمة المرور");
      return;
    }
    setLoading(true);
    try {
      const lookupRes = await fetch("/api/auth/lookup-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase() }),
      });
      const lookupData = await lookupRes.json();
      if (!lookupRes.ok) throw new Error(lookupData.error || "اسم المستخدم غير صحيح");

      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email: lookupData.email, password });
      if (error) throw new Error("كلمة المرور غير صحيحة");

      await onSuccess();
    } catch (err: any) {
      const supabase = createClient();
      await supabase.auth.signOut().catch(() => {});
      toast.error("فشل تسجيل الدخول", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 p-4" dir="rtl">
      <Toaster position="top-center" richColors dir="rtl" />
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center shadow-lg border border-white/20 mb-4 animate-bounce">
            <Heart className="w-9 h-9 text-emerald-400 fill-emerald-400" />
          </div>
          <h2 className="text-2xl font-black text-white leading-tight">مبادرة الأمراض المزمنة</h2>
          <p className="text-sm text-emerald-200/80 mt-2">مديرية الصحة بسوهاج — تسجيل الدخول</p>
        </div>

        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-md rounded-3xl overflow-hidden">
          <CardHeader className="bg-emerald-600 py-5 text-center text-white">
            <CardTitle className="text-lg font-bold">تسجيل الدخول للنظام</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 pb-6 px-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-gray-700">اسم المستخدم</Label>
              <Input
                type="text"
                placeholder="مثال: nurse_shg001"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="h-11 text-sm border-gray-200 focus:border-emerald-500"
                dir="ltr"
                style={{ direction: "ltr", textAlign: "left" }}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                autoComplete="username"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-gray-700">كلمة المرور</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="h-11 text-sm border-gray-200 focus:border-emerald-500 pr-10"
                  dir="ltr"
                  style={{ direction: "ltr", textAlign: "left" }}
                  onKeyDown={e => e.key === "Enter" && handleLogin()}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              onClick={handleLogin}
              disabled={loading}
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-all"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>جارٍ التحقق...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <LogIn className="w-4 h-4 text-white" />
                  <span>دخول</span>
                </div>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
