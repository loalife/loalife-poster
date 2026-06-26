import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signInWithEmail, signUpWithEmail } from '../src/hooks/useAuth';
import { COLORS, FONTS } from '../src/constants/theme';

export default function SignInScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email || !password) return;
    if (mode === 'signup' && !displayName) return;
    setLoading(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password, displayName);
      }
    } catch (err: any) {
      Alert.alert('エラー', err?.message ?? '認証に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.root}>
      <KeyboardAvoidingView
        style={s.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={s.logo}>🏠</Text>
        <Text style={s.title}>わたしと家族のリスト</Text>
        <Text style={s.sub}>LOALIFE</Text>

        <View style={s.form}>
          {mode === 'signup' && (
            <TextInput
              style={s.input}
              placeholder="お名前"
              value={displayName}
              onChangeText={setDisplayName}
              autoComplete="name"
            />
          )}
          <TextInput
            style={s.input}
            placeholder="メールアドレス"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <TextInput
            style={s.input}
            placeholder="パスワード"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />

          <TouchableOpacity style={s.btn} onPress={submit} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.btnText}>
                {mode === 'signin' ? 'ログイン' : 'アカウント作成'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={s.switchBtn}
            onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            <Text style={s.switchText}>
              {mode === 'signin'
                ? 'アカウントをお持ちでない方はこちら'
                : 'すでにアカウントをお持ちの方'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF0F6' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logo: { fontSize: 52, textAlign: 'center', marginBottom: 10 },
  title: {
    fontSize: 22, fontWeight: '800', textAlign: 'center',
    color: '#2E2740', marginBottom: 4,
  },
  sub: {
    fontSize: 13, fontWeight: '700', textAlign: 'center',
    color: '#9A86A8', marginBottom: 36,
  },
  form: { gap: 12 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 2, borderColor: '#FBD9E8',
    borderRadius: 14, padding: 14,
    fontSize: 15, color: '#3A2E3F',
  },
  btn: {
    backgroundColor: '#FF4D8D',
    borderRadius: 14, padding: 15,
    alignItems: 'center', marginTop: 4,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  switchBtn: { alignItems: 'center', paddingVertical: 10 },
  switchText: { color: '#9A86A8', fontSize: 13, fontWeight: '600' },
});
