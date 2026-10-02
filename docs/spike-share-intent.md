# Etapa 0 — spike de recebimento por Compartilhar (iOS e Android)

**Resultado: configuração nativa gerada e inspecionada; recebimento em tempo de execução NÃO testado (sem Xcode, SDK Android, aparelho ou emulador). Expo Go não serve de prova.**

## Abordagem escolhida
`expo-share-intent` 8.0.1 (compatível com SDK 57) via config plugin, em `apps/mobile/app.json`:
imagens (até 10) e texto no iOS; `text/*` e `image/*` (+ `SEND_MULTIPLE` de imagens) no Android; App Group `group.app.klypo.mobile`. O app usa `ShareIntentProvider` (desabilitado no Expo Go) e `ShareHandler` em `src/app/_layout.tsx`, que leva o material à tela de **Prévia**; só depois do "Salvar" ele entra na fila local durável.

## O que foi verificado (`expo prebuild --platform all`, em diretório temporário)
Artefatos gerados em `docs/spike/`:
- iOS: alvo `ShareExtension` (bundle `app.klypo.mobile.share-extension`), `NSExtensionActivationRule` com `ImageWithMaxCount=10` e `SupportsText`, entitlement `com.apple.security.application-groups` = `group.app.klypo.mobile` no app e na extensão.
- Android: `intent-filter` `SEND` (`text/*`, `image/*`) e `SEND_MULTIPLE` (`image/*`) na `MainActivity` com `launchMode="singleTask"`.
- O prebuild **não** é commitado (`ios/` e `android/` ficam no `.gitignore`; Continuous Native Generation).

## Leitura do código da extensão iOS (`ShareExtensionViewController.swift` do pacote)
- Imagens são **copiadas** para o container do App Group antes de a extensão terminar; metadados/texto vão para `UserDefaults(suiteName:)`; há tratamento "último item" para múltiplas imagens.
- Depois a extensão **abre o app host** por URL scheme (`redirectToHostApp`) e conclui. O registro na fila só acontece quando o app abre.

## Riscos e divergências em relação ao fluxo B da especificação
1. **A especificação quer que a extensão registre a fila e devolva o usuário ao app de origem sem esperar.** A biblioteca abre o Klypo. Se isso for requisito duro, o caminho é `disableIOS: true` + extensão própria que grava na fila (SQLite/arquivos no App Group) e retorna sem abrir o app. Decisão pendente com dispositivo.
2. Abrir o app host a partir da extensão depende de mecanismo não documentado pela Apple (cadeia de responders); pode quebrar em versões novas do iOS.
3. Arquivos no App Group só são movidos para a fila quando o app abre; limpeza/colisão de nomes precisa ser testada. O app copia para `Documents/captures` antes de registrar na fila.
4. Android: `singleTask` evita instâncias duplicadas; cold start vs. app em segundo plano precisa de teste real. Permissões de leitura de `content://` URIs temporárias valem só enquanto o processo vive: o app copia no mesmo fluxo.
5. Sem sessão ativa, o `ShareHandler` não consome o intent (`resetShareIntent`) até haver login.
6. DEVELOPMENT_TEAM/assinatura: o plugin avisa que é preciso definir a equipe de desenvolvimento manualmente no Xcode.

## Para fechar a etapa 0 (precisa de dispositivo/conta)
`npx expo prebuild --clean` → `eas build --profile development` (ou `expo run:ios|android`) → testar: imagem única, várias imagens, texto, app fechado, sessão expirada, envio interrompido (matar o app durante o upload) e reabrir.
