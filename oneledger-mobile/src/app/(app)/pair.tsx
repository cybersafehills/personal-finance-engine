import { Redirect, useLocalSearchParams } from "expo-router";

// Deep link target: oneledger://pair?c=<olp_ code>, the link the web pairing
// wizard and its QR produce (docs/device-pairing.md). It hands the code to
// the connect flow, which still shows the disclosure first; nothing is
// redeemed just by opening the link.
export default function PairLink() {
  const { c } = useLocalSearchParams<{ c?: string }>();
  return (
    <Redirect
      href={{ pathname: "/connect", params: c ? { code: c } : {} }}
    />
  );
}
