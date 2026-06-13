export function getFriendlyAuthError(error: any): string {
  const errorCode = error?.code || 'default';

  switch (errorCode) {
    case 'auth/operation-not-allowed':
      return 'Account registration is currently unavailable. Please try again later.';

    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Please sign in instead.';

    case 'auth/invalid-email':
      return 'Please enter a valid email address.';

    case 'auth/weak-password':
      return 'Password does not meet security requirements.';

    case 'auth/user-not-found':
      return 'No account was found for this email address.';

    case 'auth/wrong-password':
      return 'Incorrect password.';

    case 'auth/invalid-credential':
      return 'Invalid credentials. Please check your email and password.';

    case 'auth/network-request-failed':
      return 'Network connection problem. Please check your internet connection and try again.';

    case 'auth/too-many-requests':
      return 'Too many attempts detected. Please wait a few minutes before trying again.';

    default:
      return 'Something went wrong. Please try again later.';
  }
}
