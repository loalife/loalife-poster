import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, FlatList, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth, getHouseholdId, createHousehold, signOut } from '../src/hooks/useAuth';
import { useFamilyMembers, useItems } from '../src/hooks/useHousehold';
import { FamilyMember, Item, ItemType, CareKind, Repeat } from '../src/types';
import {
  TYPE_META, ME_TYPES, KIND_STYLE, REPEATS, REMINDER_OPTS,
  careKindsFor, guessEmoji, HIGH_RISK_KINDS, PET_EMOJIS, PERSON_EMOJIS,
  SPECIES, reminderLabel,
} from '../src/constants/care';
import { COLORS, RADIUS, SHADOW } from '../src/constants/theme';
import { daysUntil, fmtDate, plusDays, addInterval, iso } from '../src/lib/dates';

/* ---- due status ---- */
function dueStatus(item: Item): { label: string; tone: string } | null {
  if (!item.dueDate) return null;
  const d = daysUntil(item.dueDate)!;
  if (d > 3) return { label: fmtDate(item.dueDate), tone: 'normal' };
  if (d > 0)  return { label: `あと${d}日`, tone: 'soon' };
  if (d === 0) return { label: '今日', tone: 'today' };
  if (item.type === 'dream') return { label: 'また今度でも大丈夫', tone: 'gentle' };
  if (item.careKind && HIGH_RISK_KINDS.has(item.careKind as CareKind))
    return { label: '期限を過ぎています', tone: 'careOver' };
  return { label: `${-d}日すぎてます`, tone: 'gentle' };
}

type TabId = 'home' | 'me' | string;

export default function MainScreen() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('home');
  const [filter, setFilter] = useState<string>('all');
  const [flash, setFlash] = useState('');

  // Add-item form state
  const [draft, setDraft] = useState('');
  const [draftType, setDraftType] = useState<ItemType>('dream');
  const [draftKind, setDraftKind] = useState<CareKind>('vaccine');
  const [draftDate, setDraftDate] = useState('');
  const [draftRepeat, setDraftRepeat] = useState<Repeat>('none');
  const [draftAuto, setDraftAuto] = useState(false);

  const { members, addMember, updateMember, removeMember } = useFamilyMembers(householdId);
  const { items, addItem, updateItem, removeItem, toggleItem } = useItems(householdId);

  // Resolve householdId from user
  useEffect(() => {
    if (!user) return;
    getHouseholdId(user.uid).then((hid) => {
      if (hid) {
        setHouseholdId(hid);
      } else {
        // New user — send to onboarding
        router.replace('/onboarding');
      }
    });
  }, [user]);

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 2200);
  };

  const activeMember = members.find((m) => m.id === tab) ?? null;
  const isMemberTab = !!activeMember;

  // Reset filter and auto-fill care title when tab changes
  useEffect(() => {
    setFilter('all');
    if (activeMember) {
      const list = careKindsFor(activeMember);
      const kind = list.find((k) => k.key === draftKind) ? draftKind : list[0].key;
      if (kind !== draftKind) setDraftKind(kind as CareKind);
      const label = list.find((k) => k.key === kind)?.label ?? '';
      if (kind !== 'other' && (draft === '' || draftAuto)) {
        setDraft(label);
        setDraftAuto(true);
      } else if (kind === 'other' && draftAuto) {
        setDraft('');
        setDraftAuto(false);
      }
    } else if (draftAuto) {
      setDraft('');
      setDraftAuto(false);
    }
  }, [tab]); // eslint-disable-line

  /* ---- derived ---- */
  const visible = useMemo((): Item[] => {
    let arr = items.filter((x) => x.memberId === (tab === 'me' ? 'me' : tab));
    if (tab === 'home') return [];
    if (filter !== 'all') {
      arr = arr.filter((x) => (isMemberTab ? x.careKind === filter : x.type === filter));
    }
    arr = [...arr].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return b.createdAt - a.createdAt;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
    return arr.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
  }, [items, tab, filter, isMemberTab]);

  const todayList = useMemo(() =>
    items.filter((x) => !x.done && x.dueDate && (daysUntil(x.dueDate) ?? 1) <= 0)
         .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
  [items]);

  const summary = useMemo(() => ({
    dreams:     items.filter((x) => x.type === 'dream' && x.done).length,
    careOverdue: items.filter((x) => x.type === 'care' && !x.done && x.dueDate && (daysUntil(x.dueDate) ?? 0) < 0).length,
    family:     members.length,
  }), [items, members]);

  const meItems = items.filter((x) => x.memberId === 'me');
  const doneCount = meItems.filter((x) => x.done).length;
  const pct = meItems.length ? Math.round((doneCount / meItems.length) * 100) : 0;

  const memberStats = useMemo(() => {
    if (!isMemberTab || !activeMember) return null;
    const arr = items.filter((x) => x.memberId === activeMember.id);
    let soon = 0, over = 0;
    arr.forEach((x) => {
      const d = daysUntil(x.dueDate ?? '');
      if (d === null) return;
      if (d < 0) over++;
      else if (d <= 7) soon++;
    });
    return { soon, over };
  }, [items, tab, activeMember]);

  const statusFor = (memberId: string) => {
    const arr = items.filter((x) => x.memberId === memberId && !x.done && x.dueDate);
    let over = 0, next: Item | null = null, nextDays = Infinity;
    arr.forEach((x) => {
      const d = daysUntil(x.dueDate!)!;
      if (d < 0) over++;
      else if (d < nextDays) { nextDays = d; next = x; }
    });
    return { over, next, nextDays };
  };

  const nameOf = (memberId: string) =>
    memberId === 'me' ? 'わたし' : members.find((m) => m.id === memberId)?.name ?? '';

  /* ---- add item ---- */
  const handleAddItem = async () => {
    let title = draft.trim();
    let careMeta = null;
    if (isMemberTab && activeMember) {
      careMeta = careKindsFor(activeMember).find((x) => x.key === draftKind);
      if (!title && draftKind !== 'other') title = careMeta?.label ?? '';
    }
    if (!title || !user) return;

    const base = {
      memberId: isMemberTab ? tab : 'me',
      type: (isMemberTab ? 'care' : draftType) as ItemType,
      title,
      emoji: guessEmoji(title, isMemberTab ? (careMeta?.emoji ?? '🐾') : TYPE_META[draftType].emoji),
      dueDate: draftDate || undefined,
      repeat: draftRepeat,
      done: false,
      createdBy: user.uid,
      ...(isMemberTab ? { careKind: draftKind } : {}),
    } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>;

    await addItem(base);
    setDraftDate('');
    setDraftRepeat('none');
    if (isMemberTab && careMeta && draftKind !== 'other') {
      setDraft(careMeta.label);
      setDraftAuto(true);
    } else {
      setDraft('');
      setDraftAuto(false);
    }
  };

  const handleToggle = async (item: Item) => {
    if (!item.done && item.repeat && item.repeat !== 'none') {
      const base = item.dueDate ?? iso(new Date());
      const newDue = addInterval(base, item.repeat);
      await updateItem(item.id, { dueDate: newDue, done: false });
      showFlash(`✓ ${item.title} 完了！次回 ${fmtDate(newDue)} に更新`);
    } else {
      await toggleItem(item);
    }
  };

  const confirmDelete = (item: Item) => {
    Alert.alert('削除', `「${item.title}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => removeItem(item.id) },
    ]);
  };

  const confirmDeleteMember = (member: FamilyMember) => {
    const count = items.filter((x) => x.memberId === member.id).length;
    Alert.alert(
      `${member.name}を削除しますか？`,
      count > 0 ? `${member.name}の${KIND_STYLE[member.kind].word}（${count}件）も削除されます。` : 'この操作は元に戻せません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除する', style: 'destructive',
          onPress: async () => {
            await removeMember(member.id);
            // Items with this memberId will be cleaned up by Firestore rules/server
            setTab('home');
            showFlash(`${member.name}を削除しました`);
          },
        },
      ]
    );
  };

  if (authLoading || !householdId) {
    return (
      <SafeAreaView style={s.root}>
        <ActivityIndicator color={COLORS.pink} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  /* ---- render ---- */
  const filterChips = isMemberTab && activeMember
    ? [{ key: 'all', label: 'すべて' }, ...careKindsFor(activeMember)]
    : [{ key: 'all', label: 'すべて' }, ...ME_TYPES.map((t) => ({ key: t, label: TYPE_META[t].label }))];

  return (
    <SafeAreaView style={s.root} edges={['top']}>

      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabs} contentContainerStyle={s.tabsContent}>
        {[
          { id: 'home', label: 'ホーム' },
          { id: 'me', label: 'わたし' },
          ...members.map((m) => ({ id: m.id, label: `${m.emoji} ${m.name}` })),
        ].map(({ id, label }) => (
          <TouchableOpacity
            key={id}
            style={[s.tab, tab === id && s.tabOn]}
            onPress={() => setTab(id)}
          >
            <Text style={[s.tabText, tab === id && s.tabTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={s.tabAdd} onPress={() => router.push('/add-member')}>
          <Text style={s.tabAddText}>＋追加</Text>
        </TouchableOpacity>
      </ScrollView>

      <ScrollView style={s.body} contentContainerStyle={s.bodyContent} keyboardShouldPersistTaps="handled">

        {tab === 'home' ? (
          <HomeTab
            todayList={todayList}
            members={members}
            statusFor={statusFor}
            summary={summary}
            nameOf={nameOf}
            onTapCard={(id) => setTab(id)}
            onReset={() => signOut().then(() => {})}
          />
        ) : (
          <>
            {/* Status bar */}
            {!isMemberTab ? (
              <View style={s.meter}>
                <View style={s.meterTop}>
                  <Text style={s.meterLabel}>わくわくメーター</Text>
                  <Text style={s.meterCount}>{doneCount} / {meItems.length}</Text>
                </View>
                <View style={s.bar}>
                  <View style={[s.fill, { width: `${pct}%` }]} />
                </View>
              </View>
            ) : activeMember ? (
              <View style={s.memberStatus}>
                <Text style={[s.memberTitle, { color: KIND_STYLE[activeMember.kind].fg }]}>
                  {activeMember.emoji} {activeMember.name} の{KIND_STYLE[activeMember.kind].word}
                </Text>
                <View style={s.pillRow}>
                  <View style={s.pillSoon}>
                    <Text style={s.pillSoonText}>⏰ 近い {memberStats?.soon ?? 0}</Text>
                  </View>
                  <View style={s.pillOver}>
                    <Text style={s.pillOverText}>🔴 期限切れ {memberStats?.over ?? 0}</Text>
                  </View>
                  <TouchableOpacity onPress={() => confirmDeleteMember(activeMember)}>
                    <Text style={s.delMember}>削除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* Add form */}
            <View style={s.addBox}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={s.typeRow}>
                  {(isMemberTab && activeMember ? careKindsFor(activeMember) : ME_TYPES.map((t) => ({ key: t, label: TYPE_META[t].label, emoji: TYPE_META[t].emoji }))).map((k) => (
                    <TouchableOpacity
                      key={k.key}
                      style={[
                        s.chip,
                        (isMemberTab ? draftKind === k.key : draftType === k.key) && {
                          backgroundColor: isMemberTab && activeMember ? KIND_STYLE[activeMember.kind].fg : TYPE_META[k.key as ItemType]?.fg ?? COLORS.pink,
                          borderColor: 'transparent',
                        },
                      ]}
                      onPress={() => {
                        if (isMemberTab) {
                          setDraftKind(k.key as CareKind);
                          if (k.key === 'other' && draftAuto) { setDraft(''); setDraftAuto(false); }
                          else if (k.key !== 'other' && (draft === '' || draftAuto)) {
                            setDraft((k as any).label); setDraftAuto(true);
                          }
                        } else {
                          setDraftType(k.key as ItemType);
                        }
                      }}
                    >
                      <Text style={[s.chipText, (isMemberTab ? draftKind === k.key : draftType === k.key) && { color: COLORS.white }]}>
                        {(k as any).emoji ?? ''} {k.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <View style={s.addRow}>
                <TextInput
                  style={s.addInput}
                  value={draft}
                  onChangeText={(v) => { setDraft(v); setDraftAuto(false); }}
                  onSubmitEditing={handleAddItem}
                  placeholder={
                    isMemberTab && activeMember
                      ? draftKind === 'other' ? '内容を入力…'
                        : `${careKindsFor(activeMember).find((k) => k.key === draftKind)?.label ?? '内容'}を追加…`
                      : `${TYPE_META[draftType].label}を追加…`
                  }
                  returnKeyType="done"
                />
                <TouchableOpacity style={s.addBtn} onPress={handleAddItem}>
                  <Text style={s.addBtnText}>追加</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Filter chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              <View style={s.typeRow}>
                {filterChips.map((f) => (
                  <TouchableOpacity
                    key={f.key}
                    style={[s.filterBtn, filter === f.key && s.filterBtnOn]}
                    onPress={() => setFilter(f.key)}
                  >
                    <Text style={[s.filterBtnText, filter === f.key && s.filterBtnTextOn]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Item list */}
            {visible.length === 0 ? (
              <Text style={s.empty}>まだありません。上のフォームから追加できます。</Text>
            ) : (
              visible.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  member={activeMember}
                  onToggle={() => handleToggle(item)}
                  onDelete={() => confirmDelete(item)}
                  onSnooze={() => updateItem(item.id, { dueDate: plusDays(1) }).then(() => showFlash('明日へ送りました'))}
                />
              ))
            )}
          </>
        )}

        <Text style={s.foot}>データはクラウドに同期されます</Text>
      </ScrollView>

      {!!flash && (
        <View style={s.flash}>
          <Text style={s.flashText}>{flash}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

/* ---- ItemRow ---- */
function ItemRow({
  item, member, onToggle, onDelete, onSnooze,
}: {
  item: Item;
  member: FamilyMember | null;
  onToggle: () => void;
  onDelete: () => void;
  onSnooze: () => void;
}) {
  const meta = member ? KIND_STYLE[member.kind] : (TYPE_META[item.type] ?? TYPE_META.dream);
  const label = member
    ? careKindsFor(member).find((k) => k.key === item.careKind)?.label ?? 'ケア'
    : (TYPE_META[item.type]?.label ?? '');
  const ds = dueStatus(item);
  const overdue = item.dueDate && (daysUntil(item.dueDate) ?? 0) <= 0 && !item.done;

  return (
    <View style={[s.card, item.done && s.cardDone]}>
      <View style={[s.bubble, { backgroundColor: meta.bg }]}>
        <Text style={{ fontSize: 22 }}>{item.emoji}</Text>
      </View>
      <View style={s.cardBody}>
        <View style={s.cardRow1}>
          <View style={[s.badge, { backgroundColor: meta.bg }]}>
            <Text style={[s.badgeText, { color: meta.fg }]}>{label}</Text>
          </View>
          <Text style={[s.cardTitle, item.done && s.cardTitleDone]} numberOfLines={2}>{item.title}</Text>
        </View>
        <View style={s.metaRow}>
          {ds && (
            <Text style={[s.dueText, dueStyles[ds.tone] ?? dueStyles.normal]}>{ds.label}</Text>
          )}
          {item.repeat && item.repeat !== 'none' && (
            <Text style={s.repeatText}>🔁 {REPEATS.find((r) => r.key === item.repeat)?.label}</Text>
          )}
          {!!overdue && (
            <TouchableOpacity onPress={onSnooze} style={s.snooze}>
              <Text style={s.snoozeText}>→ 明日へ</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <TouchableOpacity style={[s.check, item.done && s.checkOn]} onPress={onToggle}>
        {item.done && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={s.delBtn} onPress={onDelete}>
        <Text style={s.delBtnText}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ---- HomeTab ---- */
function HomeTab({
  todayList, members, statusFor, summary, nameOf, onTapCard, onReset,
}: {
  todayList: Item[];
  members: FamilyMember[];
  statusFor: (id: string) => { over: number; next: Item | null; nextDays: number };
  summary: { dreams: number; careOverdue: number; family: number };
  nameOf: (id: string) => string;
  onTapCard: (id: string) => void;
  onReset: () => void;
}) {
  const spaces = [{ id: 'me', name: 'わたし', emoji: '🙂', kind: 'me' as const }, ...members];

  return (
    <>
      {/* Today */}
      {todayList.length === 0 ? (
        <View style={s.hero}>
          <Text style={{ fontSize: 38 }}>✨</Text>
          <Text style={s.heroTitle}>今日やることはありません</Text>
          <Text style={s.heroSub}>ゆっくり過ごせる一日を</Text>
        </View>
      ) : (
        <View style={s.todayCard}>
          <Text style={s.sectionTitle}>今日のこと</Text>
          {todayList.map((it) => {
            const od = (daysUntil(it.dueDate ?? '') ?? 0) < 0;
            return (
              <TouchableOpacity key={it.id} style={s.todayRow} onPress={() => onTapCard(it.memberId === 'me' ? 'me' : it.memberId)}>
                <Text style={{ fontSize: 22 }}>{it.emoji}</Text>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={s.todayText}>{it.title}</Text>
                  <Text style={s.todayWho}>{nameOf(it.memberId)}</Text>
                </View>
                <View style={[s.todayTag, od && s.todayTagOver]}>
                  <Text style={[s.todayTagText, od && { color: COLORS.red }]}>{od ? '期限切れ' : '今日'}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Status cards */}
      <Text style={[s.sectionTitle, { marginTop: 4 }]}>みんなの状態</Text>
      {spaces.map((sp) => {
        const st = statusFor(sp.id);
        const alert = st.over > 0;
        let line = '';
        let sub: string | null = null;
        if (alert) {
          line = `🔴 期限切れ ${st.over}件`;
        } else if (st.next) {
          line = sp.kind === 'pet' ? '今日は安心して過ごせます' : '順調です';
          sub = `次の予定：${st.next.title}・${st.nextDays === 0 ? '今日' : 'あと' + st.nextDays + '日'}`;
        } else {
          line = sp.kind === 'pet' ? '今日も元気です' : '予定はありません';
        }
        return (
          <TouchableOpacity key={sp.id} style={[s.statusCard, alert && s.statusCardAlert]} onPress={() => onTapCard(sp.id)}>
            <Text style={{ fontSize: 26 }}>{sp.emoji}</Text>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.statusName}>{sp.name}</Text>
              <Text style={[s.statusLine, alert && { color: COLORS.red }]}>{line}</Text>
              {sub && <Text style={s.statusSub}>{sub}</Text>}
            </View>
            <View style={[s.statusDot, { backgroundColor: alert ? COLORS.red : COLORS.mint }]} />
          </TouchableOpacity>
        );
      })}

      {/* Summary */}
      <View style={s.summaryBox}>
        <Text style={[s.sectionTitle, { color: COLORS.textMid }]}>これまでの見守り</Text>
        <View style={s.statRow}>
          {[
            { n: summary.dreams,      l: '叶えた夢' },
            { n: summary.careOverdue, l: 'ケアの取りこぼし' },
            { n: summary.family,      l: '見守る家族' },
          ].map(({ n, l }) => (
            <View key={l} style={s.stat}>
              <Text style={s.statN}>{n}</Text>
              <Text style={s.statL}>{l}</Text>
            </View>
          ))}
        </View>
      </View>

      <TouchableOpacity style={s.resetBtn} onPress={onReset}>
        <Text style={s.resetText}>ログアウト</Text>
      </TouchableOpacity>
    </>
  );
}

/* ---- due tone styles ---- */
const dueStyles: Record<string, object> = {
  normal:  { color: COLORS.textMid },
  soon:    { color: COLORS.amber },
  today:   { color: COLORS.pink },
  gentle:  { color: '#F08A3C' },
  careOver: { color: COLORS.red, backgroundColor: COLORS.redLight, paddingHorizontal: 6, borderRadius: 6 },
};

/* ---- styles ---- */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  tabs: { backgroundColor: COLORS.white, maxHeight: 52 },
  tabsContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.white,
    shadowColor: '#7A5080', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4,
    elevation: 2,
  },
  tabOn: { backgroundColor: COLORS.pink },
  tabText: { fontSize: 13, fontWeight: '700', color: COLORS.textMid },
  tabTextOn: { color: COLORS.white },
  tabAdd: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: RADIUS.pill,
    borderWidth: 2, borderStyle: 'dashed', borderColor: '#F3C3DC',
  },
  tabAddText: { fontSize: 13, fontWeight: '700', color: '#C06A99' },

  body: { flex: 1 },
  bodyContent: { padding: 14, paddingBottom: 40, gap: 10 },

  meter: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: 14,
    ...SHADOW.card,
  },
  meterTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  meterLabel: { fontSize: 13, fontWeight: '800', color: COLORS.pink },
  meterCount: { fontSize: 13, fontWeight: '800', color: COLORS.purple },
  bar: { height: 10, backgroundColor: '#F3E7EF', borderRadius: RADIUS.pill, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: COLORS.pink, borderRadius: RADIUS.pill },

  memberStatus: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: 14, ...SHADOW.card,
  },
  memberTitle: { fontSize: 14, fontWeight: '800', marginBottom: 8 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pillSoon: { backgroundColor: COLORS.amberLight, borderRadius: RADIUS.pill, paddingVertical: 4, paddingHorizontal: 10 },
  pillSoonText: { fontSize: 12, fontWeight: '800', color: COLORS.amber },
  pillOver: { backgroundColor: COLORS.redLight, borderRadius: RADIUS.pill, paddingVertical: 4, paddingHorizontal: 10 },
  pillOverText: { fontSize: 12, fontWeight: '800', color: COLORS.red },
  delMember: { marginLeft: 'auto', fontSize: 12, fontWeight: '700', color: COLORS.textLight },

  addBox: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.xl, padding: 13, ...SHADOW.card,
  },
  typeRow: { flexDirection: 'row', gap: 6 },
  chip: {
    borderWidth: 2, borderColor: '#F3E7EF', backgroundColor: COLORS.white,
    borderRadius: RADIUS.pill, paddingVertical: 6, paddingHorizontal: 11,
  },
  chipText: { fontSize: 12, fontWeight: '800', color: '#7A6C88' },
  addRow: { flexDirection: 'row', gap: 8 },
  addInput: {
    flex: 1, borderWidth: 2, borderColor: '#FBD9E8',
    borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, color: COLORS.text,
  },
  addBtn: {
    backgroundColor: COLORS.pink, borderRadius: RADIUS.md,
    paddingHorizontal: 16, justifyContent: 'center',
  },
  addBtnText: { color: COLORS.white, fontSize: 14, fontWeight: '800' },

  filterBtn: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.white,
    shadowColor: '#7A5080', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3, elevation: 1,
  },
  filterBtnOn: { backgroundColor: COLORS.text },
  filterBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.textMid },
  filterBtnTextOn: { color: COLORS.white },

  empty: { textAlign: 'center', color: COLORS.textLight, fontWeight: '600', paddingVertical: 24 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.white, borderRadius: 18, padding: 12, ...SHADOW.card,
  },
  cardDone: { opacity: 0.65 },
  bubble: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, minWidth: 0 },
  cardRow1: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  badge: { borderRadius: 7, paddingVertical: 2, paddingHorizontal: 7 },
  badgeText: { fontSize: 10, fontWeight: '800' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text, flexShrink: 1 },
  cardTitleDone: { textDecorationLine: 'line-through', color: COLORS.textLight },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  dueText: { fontSize: 11, fontWeight: '800' },
  repeatText: { fontSize: 11, fontWeight: '700', color: COLORS.textMid },
  snooze: {
    backgroundColor: '#F2ECFB', borderRadius: RADIUS.pill, paddingVertical: 3, paddingHorizontal: 8,
  },
  snoozeText: { fontSize: 11, fontWeight: '800', color: COLORS.purple },
  check: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 2.5, borderColor: '#F0C7DC', backgroundColor: COLORS.white,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: COLORS.pink, borderColor: 'transparent' },
  delBtn: {
    position: 'absolute', top: -6, right: -6,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 2, elevation: 2,
  },
  delBtnText: { fontSize: 13, color: COLORS.textLight, lineHeight: 18 },

  foot: { textAlign: 'center', fontSize: 11, color: COLORS.textLight, fontWeight: '600', marginTop: 8 },
  flash: {
    position: 'absolute', bottom: 22, alignSelf: 'center',
    backgroundColor: COLORS.text, borderRadius: RADIUS.pill, paddingVertical: 10, paddingHorizontal: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8,
  },
  flashText: { color: COLORS.white, fontSize: 13, fontWeight: '700' },

  // Home tab
  hero: {
    backgroundColor: COLORS.white, borderRadius: 22, padding: 28, alignItems: 'center', ...SHADOW.card,
  },
  heroTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginTop: 8 },
  heroSub: { fontSize: 13, fontWeight: '700', color: '#8A7C94', marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text, marginBottom: 8 },
  todayCard: { backgroundColor: COLORS.white, borderRadius: 18, padding: 14, ...SHADOW.card },
  todayRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#F6EFF4',
  },
  todayText: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  todayWho: { fontSize: 11, fontWeight: '700', color: '#A596B2', marginTop: 2 },
  todayTag: {
    backgroundColor: '#EFE7FB', borderRadius: RADIUS.pill, paddingVertical: 3, paddingHorizontal: 8,
  },
  todayTagOver: { backgroundColor: COLORS.redLight },
  todayTagText: { fontSize: 11, fontWeight: '800', color: COLORS.purple },
  statusCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.white, borderRadius: 14, padding: 13,
    borderLeftWidth: 4, borderLeftColor: COLORS.mint, ...SHADOW.card,
  },
  statusCardAlert: { borderLeftColor: COLORS.red },
  statusName: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  statusLine: { fontSize: 12, fontWeight: '700', color: '#8A7C94', marginTop: 2 },
  statusSub: { fontSize: 11, fontWeight: '700', color: COLORS.textLight, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  summaryBox: {
    backgroundColor: '#FFF0F6', borderRadius: 18, padding: 14,
  },
  statRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: COLORS.white, borderRadius: 12, padding: 12, alignItems: 'center' },
  statN: { fontSize: 22, fontWeight: '800', color: COLORS.pink },
  statL: { fontSize: 10, fontWeight: '800', color: COLORS.textMid, marginTop: 2, textAlign: 'center' },
  resetBtn: { alignSelf: 'center', paddingVertical: 8 },
  resetText: { fontSize: 11, fontWeight: '700', color: COLORS.textLight },
});
