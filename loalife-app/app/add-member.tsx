import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth, getHouseholdId } from '../src/hooks/useAuth';
import { useFamilyMembers } from '../src/hooks/useHousehold';
import { SPECIES, PET_EMOJIS, PERSON_EMOJIS } from '../src/constants/care';
import { COLORS, RADIUS, SHADOW } from '../src/constants/theme';
import { MemberKind, PetSpecies } from '../src/types';

export default function AddMemberScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [kind, setKind] = useState<MemberKind>('pet');
  const [species, setSpecies] = useState<PetSpecies>('dog');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🐶');
  const [loading, setLoading] = useState(false);

  // Resolve householdId lazily
  const [householdId, setHouseholdId] = useState<string | null>(null);
  useState(() => {
    if (user) getHouseholdId(user.uid).then(setHouseholdId);
  });

  const { addMember } = useFamilyMembers(householdId);

  const submit = async () => {
    if (!name.trim() || !householdId) return;
    setLoading(true);
    await addMember({ name: name.trim(), emoji, kind, ...(kind === 'pet' ? { species } : {}) });
    setLoading(false);
    router.back();
  };

  const emojiSet = kind === 'person' ? PERSON_EMOJIS : PET_EMOJIS;

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.back}>← 戻る</Text>
          </TouchableOpacity>
          <Text style={s.title}>家族を追加</Text>
        </View>

        <View style={s.row}>
          {[
            { value: 'pet' as MemberKind, label: '🐶 ペット' },
            { value: 'person' as MemberKind, label: '👤 家族（人）' },
          ].map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              style={[s.kindBtn, kind === value && s.kindBtnOn]}
              onPress={() => { setKind(value); setEmoji(value === 'pet' ? PET_EMOJIS[0] : PERSON_EMOJIS[0]); }}
            >
              <Text style={[s.kindBtnText, kind === value && { color: COLORS.white }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {kind === 'pet' && (
          <View style={s.row}>
            {SPECIES.map((sp) => (
              <TouchableOpacity
                key={sp.key}
                style={[s.smBtn, species === sp.key && s.kindBtnOn]}
                onPress={() => { setSpecies(sp.key); setEmoji(sp.emoji); }}
              >
                <Text style={[s.kindBtnText, species === sp.key && { color: COLORS.white }]}>
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
              style={[s.emojiBtn, emoji === e && s.emojiBtnOn]}
              onPress={() => setEmoji(e)}
            >
              <Text style={{ fontSize: 22 }}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder={kind === 'person' ? '名前（例：ゆうと）' : '名前（例：ロア）'}
          onSubmitEditing={submit}
          autoFocus
        />

        <TouchableOpacity style={s.btn} onPress={submit} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>登録</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 20, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  back: { fontSize: 14, fontWeight: '700', color: COLORS.textMid },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  row: { flexDirection: 'row', gap: 8 },
  kindBtn: {
    flex: 1, borderWidth: 2, borderColor: '#F3E7EF',
    borderRadius: RADIUS.md, padding: 10, alignItems: 'center', backgroundColor: COLORS.white,
  },
  kindBtnOn: { borderColor: 'transparent', backgroundColor: COLORS.pink },
  kindBtnText: { fontSize: 13, fontWeight: '800', color: '#7A6C88' },
  smBtn: {
    flex: 1, borderWidth: 2, borderColor: '#F3E7EF',
    borderRadius: RADIUS.md, padding: 8, alignItems: 'center', backgroundColor: COLORS.white,
  },
  emojiRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  emojiBtn: {
    width: 44, height: 44, borderRadius: RADIUS.md,
    borderWidth: 2, borderColor: '#F3E7EF', backgroundColor: COLORS.white,
    alignItems: 'center', justifyContent: 'center',
  },
  emojiBtnOn: { borderColor: COLORS.pink, backgroundColor: '#FFF0F6' },
  input: {
    borderWidth: 2, borderColor: '#FBD9E8', borderRadius: RADIUS.md,
    padding: 14, fontSize: 15, color: COLORS.text, backgroundColor: COLORS.white,
  },
  btn: { backgroundColor: COLORS.pink, borderRadius: RADIUS.md, padding: 15, alignItems: 'center' },
  btnText: { color: COLORS.white, fontSize: 16, fontWeight: '800' },
});
