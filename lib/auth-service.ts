// ─── Auth Service ───────────────────────────────────────────────
// Core auth business logic: signup, verify email, login, password reset.
// Uses custom password hashing (argon2), email verification via Resend,
// and 2FA via speakeasy. DB operations use service_role key (server-side only).

import { createServerClient } from '@/lib/supabase';
import { hashPassword, verifyPassword, generateToken, encryptData, decryptData } from '@/lib/crypto';
import { sendEmail, getVerificationEmailHTML, getPasswordResetEmailHTML } from '@/lib/email';
import { v4 as uuidv4 } from 'uuid';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

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

  const name = (displayName || '').trim();
  if (!name) {
    throw new Error('Full name is required.');
  }
  if (name.length < 2) {
    throw new Error('Name must be at least 2 characters.');
  }
  if (name.length > 50) {
    throw new Error('Name must be under 50 characters.');
  }

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  try {
    // Step 1: Check if user already exists
    const supabase = db();
    const { data: existing } = await supabase
      .from('users')
      .select('id, password_hash, email_verified')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      // If the existing account has no password_hash, it's from before custom auth.
      // Delete it so the user can re-register.
      if (!existing.password_hash) {
        console.log('⚠️ Existing user has no password_hash — deleting stale record for re-registration');
        await supabase.from('users').delete().eq('id', existing.id);
        await supabase.from('email_verification_tokens').delete().eq('user_id', existing.id);
      } else {
        console.error('❌ User already exists with valid password');
        throw new Error('Email already registered');
      }
    }

    // Step 2: Hash password
    const { hash, salt } = await hashPassword(password);
    console.log('✅ Password hashed — hash length:', hash.length, '| salt length:', salt.length, '| hash prefix:', hash.substring(0, 15));

    // Step 3: Create user in database
    const userId = uuidv4();

    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert([{
        id: userId,
        email,
        password_hash: hash,
        password_salt: salt,
        display_name: name,
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
        user_id: userId,
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
      userId: userId,
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
  console.log('👉 [AUTH-SERVICE] Verify email:', email, '| token first 8:', token?.substring(0, 8));

  try {
    const supabase = db();

    // Step 1: Find user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email_verified, password_hash')
      .eq('email', email)
      .single();

    console.log('📋 [AUTH-SERVICE] User lookup — found:', !!user, '| email_verified:', user?.email_verified, '| has password_hash:', !!user?.password_hash);

    if (userError) {
      console.error('❌ [AUTH-SERVICE] User not found:', userError.message, userError.code);
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
      .maybeSingle();

    console.log('📋 [AUTH-SERVICE] Token lookup — found:', !!tokenRecord, '| error:', tokenError?.message);

    if (tokenError || !tokenRecord) {
      console.error('❌ [AUTH-SERVICE] Token not found:', tokenError?.message, '| userId:', user.id);
      throw new Error('Verification token not found');
    }

    // Step 3: Verify token hasn't expired
    const now = new Date();
    const expires = new Date(tokenRecord.expires_at);
    console.log('📋 [AUTH-SERVICE] Token expires:', expires.toISOString(), '| now:', now.toISOString(), '| expired:', expires < now);

    if (expires < now) {
      throw new Error('Verification link has expired');
    }

    // Step 4: Verify token matches
    const { verifyToken } = await import('@/lib/crypto');
    const isValid = verifyToken(token, tokenRecord.token_hash, tokenRecord.token_salt);
    console.log('📋 [AUTH-SERVICE] Token validation:', isValid ? '✅ VALID' : '❌ INVALID');

    if (!isValid) {
      throw new Error('Invalid verification token');
    }

    // Step 5: Mark email as verified
    const updatePayload = {
      email_verified: true,
      email_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    console.log('📋 [AUTH-SERVICE] Updating user:', user.id, 'with:', JSON.stringify(updatePayload));

    const { error: updateError } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('id', user.id);

    if (updateError) {
      console.error('❌ [AUTH-SERVICE] Update failed:', updateError.message, updateError.code, updateError.details);
      throw new Error('Failed to verify email');
    }

    console.log('✅ [AUTH-SERVICE] User updated — email_verified set to true');

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

    console.log('📋 [AUTH-SERVICE] Login — user found | email_verified:', user.email_verified, '| password_hash length:', user.password_hash?.length, '| has 2FA:', user.two_factor_enabled);

    // Defensive: if password_hash is empty (account from before custom auth migration),
    // tell the user to re-register instead of crashing
    if (!user.password_hash || user.password_hash.length < 20) {
      console.error('❌ [AUTH-SERVICE] Login — password_hash empty or invalid. Account predates custom auth.');
      throw new Error('This account was created before the password system was set up. Please sign up again with the same email.');
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

// ============================================================================
// 2FA — BACKUP CODES (helper)
// ============================================================================

function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(
      Math.random()
        .toString(36)
        .substring(2, 10)
        .toUpperCase()
    );
  }
  return codes;
}

// ============================================================================
// 2FA — GENERATE SECRET & QR CODE
// ============================================================================

export async function generate2FASecret(email: string) {
  console.log('👉 [2FA] Generating secret for:', email);

  const secret = speakeasy.generateSecret({
    name: `Vantage (${email})`,
    issuer: 'Vantage',
    length: 32,
  });

  if (!secret.otpauth_url) {
    throw new Error('Failed to generate 2FA secret');
  }

  const qrCode = await QRCode.toDataURL(secret.otpauth_url);

  console.log('✅ 2FA secret generated');

  return {
    secret: secret.base32,
    qrCode,
    manualEntryKey: secret.base32,
    backupCodes: generateBackupCodes(),
  };
}

// ============================================================================
// 2FA — ENABLE FOR USER
// ============================================================================

export async function enable2FA(
  userId: string,
  secret: string,
  totpCode: string,
  backupCodes: string[]
) {
  console.log('👉 [2FA] Enabling 2FA for user:', userId);

  const supabase = db();

  // Verify the code first
  const isValid = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: totpCode,
    window: 2,
  });

  if (!isValid) {
    throw new Error('Invalid 2FA verification code');
  }

  console.log('✅ 2FA code verified');

  const encryptedSecret = encryptData(secret);
  const encryptedBackupCodes = encryptData(JSON.stringify(backupCodes));

  const { error } = await supabase.from('two_factor_auth').upsert({
    user_id: userId,
    totp_secret_encrypted: encryptedSecret,
    backup_codes_encrypted: encryptedBackupCodes,
    is_enabled: true,
    verified_at: new Date().toISOString(),
  });

  if (error) {
    console.error('❌ 2FA enable DB error:', error);
    throw new Error(`Failed to enable 2FA: ${error.message}`);
  }

  await supabase
    .from('users')
    .update({ two_factor_enabled: true })
    .eq('id', userId);

  console.log('✅ 2FA enabled');

  return {
    success: true,
    message: '2FA has been enabled successfully',
    backupCodes,
  };
}

// ============================================================================
// 2FA — VERIFY TOTP CODE
// ============================================================================

export async function verify2FACode(
  userId: string,
  totpCode: string
): Promise<boolean> {
  console.log('👉 [2FA] Verifying code for user:', userId);

  const supabase = db();

  const { data: twoFaRecord, error } = await supabase
    .from('two_factor_auth')
    .select('totp_secret_encrypted')
    .eq('user_id', userId)
    .single();

  if (error || !twoFaRecord) {
    console.error('❌ 2FA record not found');
    return false;
  }

  const secret = decryptData(twoFaRecord.totp_secret_encrypted);
  const valid = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: totpCode,
    window: 2,
  });

  console.log(valid ? '✅ 2FA code valid' : '❌ 2FA code invalid');
  return valid;
}

// ============================================================================
// 2FA — DISABLE
// ============================================================================

export async function disable2FA(userId: string, password: string) {
  console.log('👉 [2FA] Disabling 2FA for user:', userId);

  const supabase = db();

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    throw new Error('User not found');
  }

  const passwordMatch = await verifyPassword(password, user.password_hash);
  if (!passwordMatch) {
    throw new Error('Invalid password');
  }

  await supabase
    .from('two_factor_auth')
    .update({ is_enabled: false })
    .eq('user_id', userId);

  await supabase
    .from('users')
    .update({ two_factor_enabled: false })
    .eq('id', userId);

  console.log('✅ 2FA disabled');

  return { success: true, message: '2FA has been disabled' };
}

// ============================================================================
// 2FA — VERIFY BACKUP CODE
// ============================================================================

export async function verifyBackupCode(
  userId: string,
  backupCode: string
): Promise<boolean> {
  console.log('👉 [2FA] Verifying backup code for user:', userId);

  const supabase = db();

  const { data: twoFaRecord, error } = await supabase
    .from('two_factor_auth')
    .select('backup_codes_encrypted')
    .eq('user_id', userId)
    .single();

  if (error || !twoFaRecord) {
    console.error('❌ 2FA record not found');
    return false;
  }

  const backupCodes: string[] = JSON.parse(
    decryptData(twoFaRecord.backup_codes_encrypted)
  );

  const codeIndex = backupCodes.indexOf(backupCode);
  if (codeIndex === -1) {
    return false;
  }

  // Remove used code
  backupCodes.splice(codeIndex, 1);
  const encrypted = encryptData(JSON.stringify(backupCodes));

  await supabase
    .from('two_factor_auth')
    .update({ backup_codes_encrypted: encrypted })
    .eq('user_id', userId);

  console.log('✅ Backup code verified and consumed');
  return true;
}
