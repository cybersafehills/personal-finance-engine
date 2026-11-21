import * as Linking from "expo-linking";
import {router} from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { fetchStatementDownload, fetchStatements } from "@/api/mobile-api";
import { Badge, Button, Card, EmptyState, Screen, Text } from "@/components/ds";
import type { DownloadFormat, Statement } from "@/features/statements/types";
import {usePrivacy} from "@/features/privacy/PrivacyProvider";
import { useQuery } from "@/hooks/useQuery";
import {DocumentsHeader,DocumentHero} from "@/features/documents/DocumentUI";
import { formatMoney } from "@/lib/money";
import { space } from "@/theme/tokens";

const formatStatementMoney = (minor: number | null, currency: Statement["totals"][number]["currency"]) =>
  minor === null ? "—" : formatMoney(BigInt(Math.round(minor)), currency);

// Your generated statements. Totals are the stored figures from the statement
// itself (the app does no statement maths). Creation uses the canonical server
// generator. Downloads ask the server for a fresh five-minute link.
export default function Statements() {
  const load = useCallback(() => fetchStatements(), []);
  const { data, loading, refresh } = useQuery(load,{refreshIntervalMs:15000});

  return (
    <Screen>
      <DocumentsHeader tab="statements" />
      {data?.ok&&data.enabled ? <DocumentHero title="A statement for any period" detail="Choose accounts and dates. Review totals and coverage before creating a document." action="+ Create statement" onPress={()=>router.push('/statement-create')}/> : null}
      <Text variant="bodyStrong">Your statements</Text>

      {loading && !data ? (
        <Text variant="caption" color="textMuted">
          Loading…
        </Text>
      ) : data && !data.ok ? (
        <EmptyState
          title={data.message}
          action={
            data.reason === "unavailable" ? undefined : (
              <Button label="Try again" variant="secondary" onPress={refresh} />
            )
          }
        />
      ) : data && !data.enabled ? (
        <EmptyState title="Statements aren't available yet." />
      ) : data && data.statements.length === 0 ? (
        <EmptyState
          variant="setup"
          title="No statements yet"
          description="Choose your accounts and a date range to create your first statement."
          action={<Button label="Create statement" onPress={()=>router.push('/statement-create')}/>}
        />
      ) : data ? (
        data.statements.map((s) => <StatementCard key={s.id} statement={s} />)
      ) : null}
      <Text variant="caption" color="textMuted">OneLedger activity records, not official provider statements.</Text>
    </Screen>
  );
}

function StatementCard({ statement: s }: { statement: Statement }) {
  const {amountsHidden}=usePrivacy();
  const money=(minor:number|null,currency:Statement["totals"][number]["currency"])=>amountsHidden?"••••••":formatStatementMoney(minor,currency);
  const [expanded,setExpanded]=useState(false);
  const [busy, setBusy] = useState<DownloadFormat | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mixed = s.totals.length > 1;

  async function download(format: DownloadFormat) {
    setBusy(format);
    setMessage(null);
    // Always a fresh link: it lives five minutes and is opened immediately.
    const result = await fetchStatementDownload(s.id, format);
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    try {
      await Linking.openURL(result.url);
    } catch {
      setMessage("Couldn't open the download. Try again.");
    }
  }

  return (
    <Card style={{ gap: 10,padding:14 }}>
      <View style={{ gap: 2 }}>
        <Text variant="bodyStrong" style={{fontSize:14,lineHeight:20}}>{s.periodLabel}</Text>
        <Text variant="caption" color="textMuted">
          {s.scopeLabel} · {s.typeLabel} · {s.transactionCount}{" "}
          {s.transactionCount === 1 ? "transaction" : "transactions"}
        </Text>
        <Text variant="caption" color="textMuted">
          {s.reference}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
        {s.status !== "ready" ? (
          <Badge variant={s.status === "failed" ? "attention" : "neutral"}>
            {s.status === "failed" ? "Couldn't be generated" : "Being prepared"}
          </Badge>
        ) : null}
        {s.isUpdatedVersion ? <Badge variant="neutral">Updated version</Badge> : null}
        {s.warningCount > 0 ? (
          <Badge variant="attention">
            {s.warningCount === 1 ? "1 coverage note" : `${s.warningCount} coverage notes`}
          </Badge>
        ) : null}
      </View>

      {s.status === "ready"&&!expanded ? s.totals.map(t=><View key={t.currency} style={{flexDirection:"row",gap:12}}><View style={{flex:1,gap:3}}><Text variant="caption" color="textMuted">Money in</Text><Text variant="bodyStrong" color="moneyPositive" style={{fontSize:13}}>{money(t.creditsMinor,t.currency)}</Text></View><View style={{flex:1,gap:3}}><Text variant="caption" color="textMuted">Money out</Text><Text variant="bodyStrong" color="danger" style={{fontSize:13}}>{money(t.debitsMinor,t.currency)}</Text></View></View>) : null}
      {s.status === "ready"&&expanded
        ? s.totals.map((t) => (
            <View key={t.currency} style={{ gap: 2 }}>
              {mixed ? (
                <Text variant="label" color="textSecondary">
                  {t.currency}
                </Text>
              ) : null}
              <Text variant="label" color="textSecondary" tabular>
                Opening {money(t.openingMinor, t.currency)} · Closing {money(t.closingMinor, t.currency)}
              </Text>
              <Text variant="label" color="textSecondary" tabular>
                In {money(t.creditsMinor, t.currency)} · Out {money(t.debitsMinor, t.currency)} · Fees{" "}
                {money(t.feesMinor, t.currency)}
              </Text>
              {t.reconciles === false ? (
                <Text variant="caption" color="attention">
                  These figures don&apos;t add up to the closing balance. Check the full statement on the web.
                </Text>
              ) : null}
            </View>
          ))
        : null}

      <Button label={expanded ? "Hide details" : "View details"} variant="ghost" size="sm" onPress={()=>setExpanded(!expanded)}/>
      {s.status === "failed" ? <Button label="Review a new statement" size="sm" variant="secondary" onPress={()=>router.push("/statement-create")}/> : null}
      {s.status === "ready"&&expanded ? (
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <View style={{ flex: 1 }}>
            <Button
              label="PDF"
              variant="secondary"
              fullWidth
              loading={busy === "pdf"}
              disabled={busy !== null}
              onPress={() => download("pdf")}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="CSV"
              variant="secondary"
              fullWidth
              loading={busy === "csv"}
              disabled={busy !== null}
              onPress={() => download("csv")}
            />
          </View>
        </View>
      ) : null}
      {message ? (
        <Text variant="label" color="attention" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
    </Card>
  );
}
