import { useState } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail, 
  signInWithPopup 
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { Eye, EyeOff } from 'lucide-react';
import { getFriendlyAuthError } from '../utils/authErrorHandler';

export function AuthScreen() {
  const [view, setView] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Note: Only Google Authentication is fully set up in the Firebase project out of the box in this preview environment.
  // Email/Password auth will require enabling it in the Firebase Console (Authentication > Sign-in method > Email/Password).

  const handleGoogleAuth = async () => {
    try {
      setError(null);
      setLoading(true);
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.log('Authentication debug log:', err.code);
      setError(getFriendlyAuthError(err));
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (view === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else if (view === 'register') {
        if (password !== confirmPassword) {
          throw { code: 'custom/password-mismatch', message: "Passwords do not match" };
        }
        if (password.length < 8) {
          throw { code: 'custom/short-password', message: "Password must be at least 8 characters" };
        }
        // Minimal password strength check
        if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])/.test(password)) {
          throw { code: 'custom/weak-password-pattern', message: "Password must contain upper, lower case and a number" };
        }
        // To save 'name', we can update profile after creation, but for simple MVP here:
        await createUserWithEmailAndPassword(auth, email, password);
      } else if (view === 'forgot') {
        await sendPasswordResetEmail(auth, email);
        setMessage("Password reset email sent successfully. Check your inbox.");
      }
    } catch (err: any) {
      console.log('Authentication debug log:', err.code);
      
      // Handle custom local validation errors first
      if (err.code?.startsWith('custom/')) {
        setError(err.message);
      } else {
        // Handle Firebase errors
        setError(getFriendlyAuthError(err));
      }
    } finally {
      if (view !== 'forgot') {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-white">
      <div className="w-full max-w-[400px] p-8 -mt-20">
        <div className="flex justify-center mb-8">
          <img src="/logo.png" alt="DOLPHI Logo" className="w-16 h-16 object-contain mb-4 mix-blend-multiply" referrerPolicy="no-referrer" />
        </div>
        
        <h1 className="text-2xl font-bold text-center text-gray-900 tracking-tight mb-2">
          {view === 'login' && 'Welcome back'}
          {view === 'register' && 'Create your account'}
          {view === 'forgot' && 'Reset your password'}
        </h1>
        
        <p className="text-[15px] text-center text-gray-500 mb-8">
          {view === 'login' && 'Enter your details to sign in to DOLPHI'}
          {view === 'register' && 'Start organizing your thoughts with AI'}
          {view === 'forgot' && "We'll send you a link to reset your password"}
        </p>

        {error && (
          <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg mb-6 text-center shadow-sm">
            {error}
          </div>
        )}

        {message && (
          <div className="p-3 bg-green-50 border border-green-100 text-green-700 text-sm rounded-lg mb-6 text-center shadow-sm">
            {message}
          </div>
        )}

        <form onSubmit={handleEmailAuth} className="space-y-4">
          {view === 'register' && (
            <div>
              <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Full Name</label>
              <input 
                type="text" 
                value={name}
                onChange={e => setName(e.target.value)}
                required
                className="w-full px-3 py-2 border border-brand-border rounded-lg text-[15px] outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-all"
              />
            </div>
          )}

          <div>
            <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Email address</label>
            <input 
              type="email" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-brand-border rounded-lg text-[15px] outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-all"
              placeholder="name@company.com"
            />
          </div>

          {view !== 'forgot' && (
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-[13px] font-medium text-gray-700">Password</label>
                {view === 'login' && (
                  <button type="button" onClick={() => setView('forgot')} className="text-[13px] font-medium text-brand-primary hover:underline">
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-brand-border rounded-lg text-[15px] outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-all pr-10"
                  placeholder="••••••••"
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}

          {view === 'register' && (
            <div>
              <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Confirm Password</label>
              <input 
                type={showPassword ? 'text' : 'password'} 
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-brand-border rounded-lg text-[15px] outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-all"
                placeholder="••••••••"
              />
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full py-2.5 bg-brand-primary text-white rounded-lg font-medium text-[15px] hover:bg-[#15304d] transition-colors disabled:opacity-70 mt-2"
          >
            {loading ? 'Please wait...' : view === 'login' ? 'Sign In' : view === 'register' ? 'Create Account' : 'Send Reset Link'}
          </button>
        </form>

        {view !== 'forgot' && (
          <>
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Or continue with</span>
              </div>
            </div>

            <button 
              onClick={handleGoogleAuth}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-2.5 bg-white border border-brand-border text-gray-700 rounded-lg font-medium text-[15px] hover:bg-gray-50 transition-colors shadow-sm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google
            </button>
          </>
        )}

        <div className="mt-8 text-center text-[14px]">
          {view === 'login' && (
            <p className="text-gray-600">
              Don't have an account?{' '}
              <button onClick={() => setView('register')} className="font-semibold text-brand-primary hover:underline">
                Sign up
              </button>
            </p>
          )}
          {view === 'register' && (
            <p className="text-gray-600">
              Already have an account?{' '}
              <button onClick={() => setView('login')} className="font-semibold text-brand-primary hover:underline">
                Sign in
              </button>
            </p>
          )}
          {view === 'forgot' && (
            <p className="text-gray-600">
              Remember your password?{' '}
              <button onClick={() => setView('login')} className="font-semibold text-brand-primary hover:underline">
                Back to sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
