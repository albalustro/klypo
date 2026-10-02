import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { t } from "../../i18n/pt-BR";
import { getProfile } from "../../lib/api";
import { useDrafts, type PickResult } from "../../lib/drafts";
import { Banner, Button, Field, H2, P, Screen } from "../../ui/components";
import { DEFAULT_LIMITS } from "@klypo/shared";

const messages: Record<string, string> = {
  permission_photos: t.add.permissionPhotos, permission_camera: t.add.permissionCamera, too_many: t.add.tooMany, too_large: t.add.tooLarge, failed: t.common.error,
};

export default function Add() {
  const router = useRouter();
  const drafts = useDrafts();
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(""); const [textMode, setTextMode] = useState(false);
  const [first, setFirst] = useState(false);
  useEffect(() => { getProfile().then((p) => setFirst(!p?.ai_notice_accepted_at)).catch(() => {}); }, []);

  const done = (r: PickResult) => {
    if (r.ok) return router.replace("/preview");
    if (r.reason !== "canceled") setError(messages[r.reason] ?? t.common.error);
  };
  return (
    <Screen>
      {first ? <H2>{t.add.firstPrompt}</H2> : null}
      {error ? <Banner tone="warn">{error}</Banner> : null}
      {!textMode ? (
        <>
          <Button label={t.add.gallery} onPress={async () => { setError(null); done(await drafts.pickFromGallery()); }} />
          <Button label={t.add.camera} variant="secondary" onPress={async () => { setError(null); done(await drafts.takePhoto()); }} />
          <Button label={t.add.text} variant="secondary" onPress={() => setTextMode(true)} />
        </>
      ) : (
        <>
          <Field label={t.add.text} value={text} onChangeText={setText} multiline placeholder={t.add.textPlaceholder} />
          <P muted>{t.add.urlNote}</P>
          {text.length > DEFAULT_LIMITS.maxTextChars ? <Banner tone="warn">{t.add.textTooLong}</Banner> : null}
          <Button label={t.common.continue} disabled={!text.trim() || text.length > DEFAULT_LIMITS.maxTextChars} onPress={() => { drafts.addText(text); router.replace("/preview"); }} />
        </>
      )}
    </Screen>
  );
}
