import React, { useState } from 'react';

import { supabase } from '../supabaseClient';

import {

  Box,

  Button,

  TextField,

  Typography,

  CircularProgress,

  Alert,

  Stack,

  Paper,

  Divider,

} from '@mui/material';

import ParkIcon from '@mui/icons-material/Park';



const redirectTo = () => `${window.location.origin}/`;



function mapAuthError(err, context) {

  const msg = (err?.message || '').toLowerCase();

  const code = (err?.code || '').toLowerCase();



  if (msg.includes('user already registered') || code === 'user_already_exists') {

    return (

      'An account with this email already exists. Sign in instead, or use "Resend confirmation email" ' +

      'if you never verified your email.'

    );

  }



  if (msg.includes('invalid login credentials') || code === 'invalid_credentials') {

    return (

      'Invalid email or password. Common causes: wrong password, or email not confirmed yet. ' +

      'Try "Resend confirmation email" below, or reset your password.'

    );

  }



  if (msg.includes('email not confirmed') || code === 'email_not_confirmed') {

    return 'Email not confirmed yet. Use "Resend confirmation email" below, then check your inbox.';

  }



  if (context === 'signUp' && msg.includes('already')) {

    return 'This email is already registered. Switch to Sign In, or resend the confirmation email.';

  }



  return err?.message || 'Authentication failed.';

}



export default function Auth() {

  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState('');

  const [password, setPassword] = useState('');

  const [message, setMessage] = useState('');

  const [error, setError] = useState('');

  const [isSignUp, setIsSignUp] = useState(false);



  const trimmedEmail = email.trim();



  const handleSubmit = async (event) => {

    event.preventDefault();

    setLoading(true);

    setMessage('');

    setError('');



    if (!trimmedEmail) {

      setError('Email is required.');

      setLoading(false);

      return;

    }

    if (password.length < 6) {

      setError('Password must be at least 6 characters.');

      setLoading(false);

      return;

    }



    try {

      if (isSignUp) {

        const { data, error: signUpError } = await supabase.auth.signUp({

          email: trimmedEmail,

          password,

          options: { emailRedirectTo: redirectTo() },

        });



        if (signUpError) throw signUpError;



        if (data.user && (!data.user.identities || data.user.identities.length === 0)) {

          setIsSignUp(false);

          throw new Error('User already registered');

        }



        if (data.session) {

          setMessage('Account created. Signing you in…');

        } else if (data.user) {

          setMessage(

            'Account created. Check your email for a confirmation link, then sign in. ' +

            'Did not get it? Use "Resend confirmation email" below.'

          );

        } else {

          setMessage('Sign up submitted. Please check your email or try signing in.');

        }

      } else {

        const { data, error: signInError } = await supabase.auth.signInWithPassword({

          email: trimmedEmail,

          password,

        });



        if (signInError) throw signInError;



        if (!data.session) {

          throw new Error('Sign in succeeded but no session was returned. Try again or check Supabase Auth settings.');

        }

      }

    } catch (err) {

      console.error('Authentication error:', err);

      setError(mapAuthError(err, isSignUp ? 'signUp' : 'signIn'));

    } finally {

      setLoading(false);

    }

  };



  const resendConfirmation = async () => {

    if (!trimmedEmail) {

      setError('Enter your email first.');

      return;

    }

    setLoading(true);

    setMessage('');

    setError('');

    try {

      const { error: resendError } = await supabase.auth.resend({

        type: 'signup',

        email: trimmedEmail,

        options: { emailRedirectTo: redirectTo() },

      });

      if (resendError) throw resendError;

      setMessage('Confirmation email sent. Check your inbox and spam folder, then sign in.');

    } catch (err) {

      console.error('Resend confirmation error:', err);

      setError(err.message || 'Could not resend confirmation email.');

    } finally {

      setLoading(false);

    }

  };



  const resetPassword = async () => {

    if (!trimmedEmail) {

      setError('Enter your email first.');

      return;

    }

    setLoading(true);

    setMessage('');

    setError('');

    try {

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {

        redirectTo: redirectTo(),

      });

      if (resetError) throw resetError;

      setMessage('Password reset email sent. Open the link in your email to set a new password.');

    } catch (err) {

      console.error('Password reset error:', err);

      setError(err.message || 'Could not send password reset email.');

    } finally {

      setLoading(false);

    }

  };



  const toggleMode = () => {

    setIsSignUp((prev) => !prev);

    setMessage('');

    setError('');

  };



  return (

    <Box

      sx={{

        minHeight: '100vh',

        display: 'flex',

        alignItems: 'center',

        justifyContent: 'center',

        p: 2,

        bgcolor: 'background.default',

        backgroundImage: 'radial-gradient(ellipse at top, rgba(139, 195, 74, 0.12), transparent 55%)',

      }}

    >

      <Paper sx={{ width: '100%', maxWidth: 420, p: { xs: 3, sm: 4 } }}>

        <Box sx={{ textAlign: 'center', mb: 3 }}>

          <Box

            sx={{

              width: 56,

              height: 56,

              borderRadius: '50%',

              bgcolor: 'primary.main',

              color: 'primary.contrastText',

              display: 'inline-flex',

              alignItems: 'center',

              justifyContent: 'center',

              mb: 2,

            }}

          >

            <ParkIcon fontSize="large" />

          </Box>

          <Typography component="h1" variant="h5" gutterBottom sx={{ fontWeight: 800 }}>

            My Orchard

          </Typography>

          <Typography variant="body2" color="text.secondary">

            {isSignUp ? 'Create your account to manage your farm' : 'Sign in to continue'}

          </Typography>

        </Box>



        <Box component="form" onSubmit={handleSubmit}>

          <TextField

            margin="normal"

            required

            fullWidth

            id="email"

            label="Email"

            name="email"

            type="email"

            autoComplete="email"

            autoFocus

            value={email}

            onChange={(e) => setEmail(e.target.value)}

          />

          <TextField

            margin="normal"

            required

            fullWidth

            name="password"

            label="Password"

            type="password"

            id="password"

            autoComplete={isSignUp ? 'new-password' : 'current-password'}

            value={password}

            onChange={(e) => setPassword(e.target.value)}

            helperText="Minimum 6 characters"

          />



          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

          {message && <Alert severity="success" sx={{ mt: 2 }}>{message}</Alert>}



          <Button

            type="submit"

            fullWidth

            variant="contained"

            size="large"

            sx={{ mt: 3, mb: 1 }}

            disabled={loading}

          >

            {loading ? <CircularProgress size={24} color="inherit" /> : (isSignUp ? 'Create Account' : 'Sign In')}

          </Button>



          {!isSignUp && (

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>

              <Button fullWidth variant="outlined" size="small" onClick={resendConfirmation} disabled={loading}>

                Resend confirmation

              </Button>

              <Button fullWidth variant="outlined" size="small" onClick={resetPassword} disabled={loading}>

                Forgot password

              </Button>

            </Stack>

          )}



          <Divider sx={{ my: 2 }} />



          <Button fullWidth variant="text" onClick={toggleMode} disabled={loading}>

            {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}

          </Button>

        </Box>

      </Paper>

    </Box>

  );

}

