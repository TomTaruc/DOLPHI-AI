import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { DecodedIdToken } from 'firebase-admin/auth';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  dbUser?: typeof users.$inferSelect;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    
    // Auto-create user in DB
    let [dbUser] = await db.select().from(users).where(eq(users.uid, decodedToken.uid));
    
    if (!dbUser) {
      const inserted = await db.insert(users).values({
        uid: decodedToken.uid,
        email: decodedToken.email || '',
      }).returning();
      dbUser = inserted[0];
    } else if (dbUser.email !== (decodedToken.email || '')) {
      const updated = await db.update(users).set({
        email: decodedToken.email || '',
      }).where(eq(users.uid, decodedToken.uid)).returning();
      dbUser = updated[0];
    }
      
    req.dbUser = dbUser;
    
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

