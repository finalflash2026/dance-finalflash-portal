import { SettingsClient } from "../../settings/SettingsClient";
import { demoProfile } from "../data";

export default function DemoSettings() {
  return (
    <SettingsClient
      profile={demoProfile("admin")}
      initialToken="demo-token-0123456789abcdef"
      initialSubgenre2={3}
      initialSubgenre3={null}
      baseUrl="https://example.com"
      vapidPublicKey=""
    />
  );
}
