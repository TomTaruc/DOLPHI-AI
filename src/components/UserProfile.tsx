import { useState, useRef, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Settings, LogOut, User as UserIcon } from 'lucide-react';

export function UserProfile() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  const user = auth.currentUser;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!user) return null;

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const displayName = user.displayName || 'DOLPHI User';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <>
      <div className="relative mt-auto pt-2 pb-4 px-3 border-t border-white/10" ref={menuRef}>
        <div 
          className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 cursor-pointer transition-colors group"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <div className="w-8 h-8 rounded bg-brand-accent flex items-center justify-center text-brand-primary font-bold shadow-sm shrink-0">
            {user.photoURL ? (
              <img src={user.photoURL} alt={displayName} className="w-full h-full rounded" />
            ) : (
              initial
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{displayName}</p>
            <p className="text-[11px] text-white/50 truncate w-full">{user.email}</p>
          </div>
        </div>

        {menuOpen && (
          <div className="absolute bottom-full left-3 w-56 mb-2 bg-white rounded-lg shadow-lg border border-brand-border py-1 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-3">
               <div className="w-8 h-8 rounded bg-brand-primary flex items-center justify-center text-brand-accent font-bold text-sm shrink-0">
                 {user.photoURL ? (
                    <img src={user.photoURL} alt={displayName} className="w-full h-full rounded object-cover" />
                  ) : (
                    initial
                  )}
               </div>
               <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
                  <p className="text-[11px] text-gray-500 truncate">{user.email}</p>
               </div>
            </div>
            
            <button className="w-full flex items-center px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left mt-1">
              <UserIcon size={16} className="mr-2 text-gray-400" />
              My Profile
            </button>
            <button className="w-full flex items-center px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left">
              <Settings size={16} className="mr-2 text-gray-400" />
              Settings
            </button>
            <div className="h-px bg-gray-100 my-1"></div>
            <button 
              onClick={() => { setMenuOpen(false); setShowSignOutConfirm(true); }}
              className="w-full flex items-center px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
            >
              <LogOut size={16} className="mr-2 text-red-500" />
              Sign Out
            </button>
          </div>
        )}
      </div>

      {showSignOutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-50">
          <div className="bg-white rounded-xl shadow-lg w-[320px] p-6 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Sign Out?</h3>
            <p className="text-sm text-gray-500 mb-6">Are you sure you want to sign out of DOLPHI?</p>
            <div className="flex items-center justify-end gap-3">
               <button 
                 onClick={() => setShowSignOutConfirm(false)}
                 className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
               >
                 Cancel
               </button>
               <button 
                 onClick={() => {
                   setShowSignOutConfirm(false);
                   handleSignOut();
                 }}
                 className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors"
               >
                 Sign Out
               </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
