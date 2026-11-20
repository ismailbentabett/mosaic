import { Alert, Anchor, Box, Button, Card, Center, Group, PasswordInput, PinInput, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconLock } from '@tabler/icons-react';
import { useRef, useState, type FormEvent } from 'react';
import { BrandLockup } from '../../app/Brand';
import { STROKE } from '../../app/icons';
import { lastEmail, signIn } from '../../auth';

const CODE_LEN = 6;

/**
 * Owner sign-in: email, app password, authenticator code (or one recovery code).
 * The password and code live only in component state until signIn() sends them; nothing here stores or logs them.
 */
export function Login() {
  const remembered = lastEmail() ?? '';
  const [email, setEmail] = useState(remembered);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);
  const recoveryRef = useRef<HTMLInputElement>(null);

  const focusCode = () => window.setTimeout(() => (recovery ? recoveryRef.current : pinRef.current)?.focus(), 0);

  const submit = async (codeNow = code) => {
    if (busy) return;
    const c = recovery ? codeNow.trim().toUpperCase() : codeNow.replace(/\D/g, '');
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (recovery ? !c : c.length !== CODE_LEN) {
      setError(recovery ? 'Enter the recovery code.' : 'Enter the 6-digit code.');
      focusCode();
      return;
    }
    setError(null);
    setBusy(true);
    const err = await signIn(email.trim(), password, c);
    setBusy(false);
    if (err) {
      setError(err);
      setCode('');
      focusCode();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const swap = () => {
    setRecovery((r) => !r);
    setCode('');
    setError(null);
    window.setTimeout(() => (recovery ? pinRef.current : recoveryRef.current)?.focus(), 0);
  };

  return (
    <Center mih="100dvh" p="md" bg="var(--mantine-color-body)">
      <Card withBorder radius="lg" p="xl" w="100%" maw={400} shadow="sm">
        <form onSubmit={onSubmit} noValidate>
          <Stack gap="md">
            <Center>
              <BrandLockup size={40} tagline />
            </Center>

            {error && (
              <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} stroke={STROKE} />} role="alert">
                {error}
              </Alert>
            )}

            <TextInput
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              autoFocus={!remembered}
              required
            />

            <PasswordInput
              label="App password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              autoFocus={!!remembered}
              required
            />

            {recovery ? (
              <TextInput
                ref={recoveryRef}
                label="Recovery code"
                description="One of the codes you saved when you set up Mosaic. See password manager."
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
                styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', letterSpacing: '0.08em' } }}
              />
            ) : (
              <Box>
                <Text component="label" size="sm" fw={600} display="block" mb={6} id="login-code-label">
                  Authenticator code
                </Text>
                <PinInput
                  ref={pinRef}
                  length={CODE_LEN}
                  type="number"
                  oneTimeCode
                  inputMode="numeric"
                  value={code}
                  onChange={setCode}
                  onComplete={(v) => {
                    if (email.trim() && password) void submit(v);
                  }}
                  aria-labelledby="login-code-label"
                  gap={8}
                  size="md"
                />
              </Box>
            )}

            <Group justify="space-between" align="center">
              <Anchor component="button" type="button" size="sm" onClick={swap}>
                {recovery ? 'Use the authenticator code' : 'Use a recovery code'}
              </Anchor>
            </Group>

            <Button type="submit" size="md" loading={busy} leftSection={<IconLock size={18} stroke={STROKE} />} fullWidth>
              {busy ? 'Signing in' : 'Sign in'}
            </Button>

            <Text size="xs" c="dimmed" ta="center">
              Private. Owner only.
            </Text>
          </Stack>
        </form>
      </Card>
    </Center>
  );
}
