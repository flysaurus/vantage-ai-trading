// ─── Auth Service ───────────────────────────────────────────────
// Core auth business logic: signup, verify email, login, password reset.
// Uses custom password hashing (argon2), email verification via Resend,
// and 2FA via speakeasy. DB operations use service_role key (server-side only).

import { createServerClient } from '@/lib/supabase';
import { hashPassword, verifyPassword, generateToken, encryptData, decryptData } from '@/lib/crypto';
import { sendEmail, getVerificationEmailHTML, getPasswordResetEmailHTML } from '@/lib/email';
import { v4 as uuidv4 } from 'uuid';

// ─── Resolve the Supabase client once at the top ─────────────────
// createServerClient is safe because auth-service is only used in API routes / server components.

function db() {
  return createServerClient() as any;
}

// ============================================================================
// SIGNUP
// ============================================================================

export async function authSignup(email: string, password: string, displayName: string) {
  console.log('👉 [AUTH-SERVICE] Signup:', email);

  if (!email || !password) {
    throw new Error('Email and password required');
  }

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  try {
    // Step 1: Check if user already exists
    const supabase = db();
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      console.error('❌ User already exists');
      throw new Error('Email already registered');
    }

    // Step 2: Hash password
    const { hash, salt } = await hashPassword(password);
    console.log('✅ Password hashed');

    // Step 3: Create user in database
    const userId = uuidv4();

    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert([{
        id: userId,
        email,
        password_hash: hash,
        password_salt: salt,
        display_name: displayName || email.split('@')[0],
        email_verified: false,
        status: 'active',
        investor_style: 'buffett',
        investor_style_onboarded: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (userError) {
      console.error('❌ User creation error — code:', userError.code, 'message:', userError.message, 'details:', userError.details, 'hint:', userError.hint);
      throw new Error(`Failed to create user: ${userError.message} (code: ${userError.code}, hint: ${userError.hint || 'none'})`);
    }

    console.log('✅ User created:', newUser.id);

    // Step 4: Generate email verification token
    const { token, hash: tokenHash, salt: tokenSalt } = generateToken();

    const { error: tokenError } = await supabase
      .from('email_verification_tokens')
      .insert([{
        user_id: newUser.id,
        token_hash: tokenHash,
        token_salt: tokenSalt,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }]);

    if (tokenError) {
      console.error('❌ Token creation error — code:', tokenError.code, 'message:', tokenError.message);
      throw new Error(`Failed to create verification token: ${tokenError.message}`);
    }

    console.log('✅ Verification token created');

    // Step 5: Send verification email (best-effort — don't fail signup if email fails)
    let emailSent = false;
    let previewUrl: string | undefined;
    try {
      const emailHTML = getVerificationEmailHTML(token, email);
      const result = await sendEmail({
        to: email,
        subject: 'Verify Your Vantage Account',
        html: emailHTML,
      });
      emailSent = true;
      previewUrl = result.previewUrl || undefined;
      console.log('✅ Verification email sent');
    } catch (emailErr: any) {
      console.error('⚠️ Failed to send verification email:', emailErr.message);
      // Don't throw — user was created successfully, email delivery is secondary
    }

    // Return token when email wasn't delivered to a real inbox (Ethereal or failed)
    const includeToken = !emailSent || !!previewUrl;

    return {
      success: true,
      userId: newUser.id,
      email,
      emailSent,
      ...(includeToken && { verificationToken: token }),
      ...(previewUrl && { previewUrl }),
      message: emailSent
        ? (previewUrl ? 'Account created! Email sent to Ethereal (preview in console).' : 'Account created! Check your email to verify.')
        : 'Account created! Use the verificationToken to verify via /api/auth/verify-email.',
    };
  } catch (err) {
    console.error('❌ Signup error:', err);
    throw err;
  }
}

// ============================================================================
// VERIFY EMAIL
// ============================================================================

export async function authVerifyEmail(email: string, token: string) {
  console.log('👉 [AUTH-SERVICE] Verify email:', email);

  try {
    const supabase = db();

    // Step 1: Find user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email_verified')
      .eq('email', email)
      .single();

    if (userError) {
      throw new Error('User not found');
    }

    if (user.email_verified) {
      throw new Error('Email already verified');
    }

    // Step 2: Find token
    const { data: tokenRecord, error: tokenError } = await supabase
      .from('email_verification_tokens')
      .select('token_hash, token_salt, expires_at')
      .eq('user_id', user.id)
      .single();

    if (tokenError) {
      throw new Error('Verification token not found');
    }

    // Step 3: Verify token hasn't expired
    if (new Date(tokenRecord.expires_at) < new Date()) {
      throw new Error('Verification link has expired');
    }

    // Step 4: Verify token matches
    const { verifyToken } = await import('@/lib/crypto');
    const isValid = verifyToken(token, tokenRecord.token_hash, tokenRecord.token_salt);

    if (!isValid) {
      throw new Error('Invalid verification token');
    }

    // Step 5: Mark email as verified
    const { error: updateError } = await supabase
      .from('users')
      .update({
        email_verified: true,
        email_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      throw new Error('Failed to verify email');
    }

    // Step 6: Delete used token
    await supabase
      .from('email_verification_tokens')
      .delete()
      .eq('user_id', user.id);

    console.log('✅ Email verified');

    return {
      success: true,
      message: 'Email verified! You can now log in.',
    };
  } catch (err) {
    console.error('❌ Verify email error:', err);
    throw err;
  }
}

// ============================================================================
// LOGIN
// ============================================================================

export async function authLogin(email: string, password: string) {
  console.log('👉 [AUTH-SERVICE] Login:', email);

  try {
    const supabase = db();

    // Step 1: Find user + verify password (check password first — don't leak verification status)
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email_verified, password_hash, status, two_factor_enabled')
      .eq('email', email)
      .single();

    if (userError) {
      console.log('❌ User not found');
      throw new Error('Invalid email or password');
    }

    // Verify password BEFORE checking email_verified — so wrong password always shows "Invalid credentials"
    const passwordMatch = await verifyPassword(password, user.password_hash);

    if (!passwordMatch) {
      console.log('❌ Password incorrect');

      // Log failed attempt
      await supabase
        .from('login_audit_log')
        .insert([{
          email,
          success: false,
          failure_reason: 'Invalid password',
          attempted_at: new Date().toISOString(),
        }]);

      throw new Error('Invalid email or password');
    }

    console.log('✅ Password verified');

    // Step 2: Check email verification and account status (password was correct)
    if (!user.email_verified) {
      console.log('❌ Email not verified');
      throw new Error('Please verify your email before logging in');
    }

    if (user.status !== 'active') {
      throw new Error('Your account is not active');
    }

    // Step 3: Check if 2FA enabled
    if (user.two_factor_enabled) {
      console.log('👉 2FA required');
      return {
        success: false,
        requires2FA: true,
        userId: user.id,
        message: 'Please complete 2FA verification',
      };
    }

    // Step 4: Update last_login
    await supabase
      .from('users')
      .update({
        last_login: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    // Log successful login
    await supabase
      .from('login_audit_log')
      .insert([{
        user_id: user.id,
        email,
        success: true,
        attempted_at: new Date().toISOString(),
      }]);

    console.log('✅ Login successful');

    return {
      success: true,
      userId: user.id,
      message: 'Login successful',
    };
  } catch (err) {
    console.error('❌ Login error:', err);
    throw err;
  }
}

// ============================================================================
// REQUEST PASSWORD RESET
// ============================================================================

export async function authRequestPasswordReset(email: string) {
  console.log('👉 [AUTH-SERVICE] Request password reset:', email);

  try {
    const supabase = db();

    // Step 1: Find user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (userError) {
      // Don't reveal if email exists
      console.log('ℹ️ Email not found, but not revealing');
      return {
        success: true,
        message: 'If this email exists, a password reset link has been sent',
      };
    }

    // Step 2: Delete any existing reset tokens
    await supabase
      .from('password_reset_tokens')
      .delete()
      .eq('user_id', user.id);

    // Step 3: Generate reset token
    const { token, hash, salt } = generateToken();

    const { error: tokenError } = await supabase
      .from('password_reset_tokens')
      .insert([{
        user_id: user.id,
        token_hash: hash,
        token_salt: salt,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }]);

    if (tokenError) {
      throw new Error('Failed to create reset token');
    }

    // Step 4: Send reset email
    const emailHTML = getPasswordResetEmailHTML(token, email);
    await sendEmail({
      to: email,
      subject: 'Reset Your Vantage Password',
      html: emailHTML,
    });

    console.log('✅ Password reset email sent');

    return {
      success: true,
      message: 'If this email exists, a password reset link has been sent',
    };
  } catch (err) {
    console.error('❌ Request password reset error:', err);
    throw err;
  }
}

// ============================================================================
// RESET PASSWORD
// ============================================================================

export async function authResetPassword(email: string, token: string, newPassword: string) {
  console.log('👉 [AUTH-SERVICE] Reset password:', email);

  if (newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  try {
    const supabase = db();

    // Step 1: Find user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (userError) {
      throw new Error('User not found');
    }

    // Step 2: Find reset token
    const { data: tokenRecord, error: tokenError } = await supabase
      .from('password_reset_tokens')
      .select('token_hash, token_salt, expires_at, used_at')
      .eq('user_id', user.id)
      .single();

    if (tokenError) {
      throw new Error('Reset token not found');
    }

    if (tokenRecord.used_at) {
      throw new Error('This reset link has already been used');
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      throw new Error('Reset link has expired');
    }

    // Step 3: Verify token
    const { verifyToken } = await import('@/lib/crypto');
    const isValid = verifyToken(token, tokenRecord.token_hash, tokenRecord.token_salt);

    if (!isValid) {
      throw new Error('Invalid reset token');
    }

    // Step 4: Hash new password
    const { hash, salt } = await hashPassword(newPassword);

    // Step 5: Update password
    const { error: updateError } = await supabase
      .from('users')
      .update({
        password_hash: hash,
        password_salt: salt,
        last_password_change: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      throw new Error('Failed to reset password');
    }

    // Step 6: Mark token as used
    await supabase
      .from('password_reset_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('user_id', user.id);

    console.log('✅ Password reset successfully');

    return {
      success: true,
      message: 'Password reset successfully. You can now log in.',
    };
  } catch (err) {
    console.error('❌ Reset password error:', err);
    throw err;
  }
}
