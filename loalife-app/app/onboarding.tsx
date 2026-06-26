import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth, createHousehold } from '../src/hooks/useAuth';
import { useFamilyMembers, useItems } from '../src/hooks/useHousehold';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../src/lib/firebase';
import { guessEmoji, SPECIES, PET_EMOJIS, PERSON_EMOJIS } from '../src/constants/care';
import { COLORS, RADIUS, SHADOW } from '../src/constants/theme';

type Step = 0 | 1 | 2;

export default function OnboardingScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>(0);
  const [wish, setWish] = useState('');
  const [memberKind, setMemberKind] = useState<'pet' | 'person' | null>(null);
  const [species, setSpecies] = useState<'dog' | 'cat' | 'other'>('dog');
  const [memberName, setMemberName] = useState('');
  const [memberEmoji, setMemberEmoji] = useState('🐶');
  const [loading, setLoading] = useState(false);

  const finish = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const householdId = await createHousehold(user.uid, user.displayName ?? 'わたし');

      // Add initial wish as a dream item
      if (wish.trim()) {
        await setDoc(
          doc(db, 'households', householdId, 'items', `wish_${Date.now()}`),
          {
            memberId: 'me',
            type: 'dream',
            title: wish.trim(),
            emoji: guessEmoji(wish.trim(), '🌈'),
            repeat: 'none',
            done: false,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }
        );
      }

      // Add initial family member
      if (memberKind && memberName.trim()) {
        const mData: Record<string, unknown> = {
          name: memberName.trim(),
          emoji: memberEmoji,
          kind: memberKind,
          createdAt: serverTimestamp(),
        };
        if (memberKind === 'pet') mData.species = species;
        await setDoc(
          doc(db, 'households', householdId, 'familyMembers', `member_${Date.now()}`),
          mData
        );
      }

      router.replace('/');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const emojiSet = memberKind === 'person' ? PERSON_EMOJIS : PET_EMOJIS;

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {step === 0 && (
          <View style={s.inner}>
            <Text style={s.bigEmoji}>🏠</Text>
            <Text style={s.title}>わたしと、大切な家族を、{'\n'}ひとつの場所で。</Text>
            <Text style={s.sub}>家族みんなの"状態"が、ひと目でわかる。</Text>
            <TouchableOpacity style={s.btn} onPress={() => setStep(1)}>
              <Text style={s.btnText}>はじめる</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 1 && (
          <View style={s.inner}>
            <Text style={s.stepLabel}>1 / 2</Text>
            <Text style={s.stepTitle}>まず、あなたの{'\n'}「やりたいこと」を1つ</Text>
            <Text style={s.sub}>あとからいつでも追加できます</Text>

            <View style={s.chips}>
              {['旅行に行く', '資格をとる', 'カフェ巡り', '運動を習慣に'].map((ex) => (
                <TouchableOpacity key={ex} style={s.chip} onPress={() => setWish(ex)}>
                  <Text style={s.chipText}>{ex}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={s.input}
              value={wish}
              onChangeText={setWish}
              placeholder="やりたいこと…"
              onSubmitEditing={() => setStep(2)}
            />

            <TouchableOpacity style={s.btn} onPress={() => setStep(2)}>
              <Text style={s.btnText}>次へ</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.link} onPress={() => { setWish(''); setStep(2); }}>
              <Text style={s.linkText}>スキップ</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 2 && (
          <View style={s.inner}>
            <Text style={s.stepLabel}>2 / 2</Text>
            <Text style={s.stepTitle}>一緒に見守りたい{'\n'}家族はいますか？</Text>

            {!memberKind ? (
              <View style={s.choices}>
                <TouchableOpacity style={s.choice} onPress={() => { setMemberKind('pet'); setMemberEmoji(PET_EMOJIS[0]); }}>
                  <Text style={s.choiceText}>🐶 ペット</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.choice} onPress={() => { setMemberKind('person'); setMemberEmoji(PERSON_EMOJIS[0]); }}>
                  <Text style={s.choiceText}>👧 家族（人）</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.link} onPress={finish}>
                  <Text style={s.linkText}>今は追加しない</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.memberForm}>
                {memberKind === 'pet' && (
                  <View style={s.row}>
                    {SPECIES.map((sp) => (
                      <TouchableOpacity
                        key={sp.key}
                        style={[s.kindBtn, species === sp.key && s.kindBtnOn]}
                        onPress={() => { setSpecies(sp.key); setMemberEmoji(sp.emoji); }}
                      >
                        <Text style={[s.kindBtnText, species === sp.key && s.kindBtnTextOn]}>
                          {sp.emoji} {sp.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                <View style={s.emojiRow}>
                  {emojiSet.map((e) => (
                    <TouchableOpacity
                      key={e}
                      style={[s.emojiBtn, memberEmoji === e && s.emojiBtnOn]}
                      onPress={() => setMemberEmoji(e)}
                    >
                      <Text style={{ fontSize: 22 }}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TextInput
                  style={s.input}
                  value={memberName}
                  onChangeText={setMemberName}
                  placeholder={memberKind === 'person' ? '名前（例：ゆうと）' : '名前（例：ロア）'}
                  onSubmitEditing={finish}
                  autoFocus
                />

                {loading ? (
                  <ActivityIndicator color={COLORS.pink} style={{ marginTop: 16 }} />
                ) : (
                  <TouchableOpacity style={s.btn} onPress={finish}>
                    <Text style={s.btnText}>はじめる</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={s.link} onPress={() => setMemberKind(null)}>
                  <Text style={s.linkText}>戻る</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  inner: { alignItems: 'center', gap: 8 },
  bigEmoji: { fontSize: 52, marginBottom: 8 },
  title: {
    fontSize: 22, fontWeight: '800', color: '#2E2740',
    textAlign: 'center', lineHeight: 30, marginBottom: 4,
  },
  stepLabel: { fontSize: 12, fontWeight: '800', color: '#C06A99', letterSpacing: 1, marginBottom: 8 },
  stepTitle: {
    fontSize: 20, fontWeight: '800', color: '#3A2E3F',
    textAlign: 'center', lineHeight: 28, marginBottom: 4,
  },
  sub: { fontSize: 13, fontWeight: '700', color: '#8A7C94', textAlign: 'center', marginBottom: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 12 },
  chip: {
    borderWidth: 2, borderColor: '#F3D9E8', borderRadius: RADIUS.pill,
    paddingVertical: 8, paddingHorizontal: 14, backgroundColor: COLORS.white,
  },
  chipText: { fontSize: 13, fontWeight: '800', color: '#C0568F' },
  input: {
    width: '100%', borderWidth: 2, borderColor: '#FBD9E8',
    borderRadius: RADIUS.md, padding: 14,
    fontSize: 15, color: COLORS.text, backgroundColor: COLORS.white, marginBottom: 4,
  },
  btn: {
    width: '100%', backgroundColor: COLORS.pink,
    borderRadius: RADIUS.md, padding: 15, alignItems: 'center', marginTop: 4,
  },
  btnText: { color: COLORS.white, fontSize: 16, fontWeight: '800' },
  link: { paddingVertical: 10, alignItems: 'center' },
  linkText: { color: COLORS.textMid, fontSize: 13, fontWeight: '800' },
  choices: { width: '100%', gap: 10, marginTop: 8 },
  choice: {
    borderWidth: 2, borderColor: '#EEE3F3', borderRadius: RADIUS.lg,
    padding: 16, backgroundColor: COLORS.white, alignItems: 'center',
  },
  choiceText: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  memberForm: { width: '100%', gap: 10 },
  row: { flexDirection: 'row', gap: 8 },
  kindBtn: {
    flex: 1, borderWidth: 2, borderColor: '#F3E7EF',
    borderRadius: RADIUS.md, padding: 9, alignItems: 'center', backgroundColor: COLORS.white,
  },
  kindBtnOn: { borderColor: 'transparent', backgroundColor: COLORS.pink },
  kindBtnText: { fontSize: 13, fontWeight: '800', color: '#7A6C88' },
  kindBtnTextOn: { color: COLORS.white },
  emojiRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  emojiBtn: {
    width: 44, height: 44, borderRadius: RADIUS.md,
    borderWidth: 2, borderColor: '#F3E7EF', backgroundColor: COLORS.white,
    alignItems: 'center', justifyContent: 'center',
  },
  emojiBtnOn: { borderColor: COLORS.pink, backgroundColor: '#FFF0F6' },
});
