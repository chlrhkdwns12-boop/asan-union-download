/**
 * 아산 교통약자 이동지원센터 노동조합 — 아이폰용 웹앱(PWA) 설정
 *
 * · firebase: 안드로이드 앱과 **같은 프로젝트**(asan-union-box)를 씁니다.
 *             웹 API 키는 공개되어도 되는 값입니다(권한은 Firestore 규칙이 판정).
 * · nameAuthUrl: **이름만 적으면 바로 입장**하게 해 주는 중계 서버 주소.
 *             POST {action:"nameAuth", name} → {ok, customToken, uid, name, role}
 *             (계약·서버 코드: work/asan-union-web/server/nameAuth.gs)
 *             비어 있으면 relayUrl 로 보냅니다.
 * · relayUrl: 안드로이드 앱이 쓰는 AI 챗봇 중계 서버(Apps Script).
 */
window.APP_CONFIG = {
  version: "1.0",
  firebase: {
    apiKey: "AIzaSyBzlvK5VPugrOn3DVT-_B0S7pDHp_dmyBI",
    authDomain: "asan-union-box.firebaseapp.com",
    projectId: "asan-union-box",
    storageBucket: "asan-union-box.firebasestorage.app",
    messagingSenderId: "199409554557"
  },
  // 2026-11-26 서버팀이 배포한 새 중계 서버(asan-union-dm-push) — 여기에 nameAuth 한 조각만 더하면 켜진다.
  // (같은 프로젝트에 넣으면 주소가 그대로라 이 파일은 고칠 필요가 없다)
  nameAuthUrl: "https://script.google.com/macros/s/AKfycbwi_cSQgG9xA8D25YEyciXcrmnLhzljb3DhSt-ox1_pdCfGZzhmYFqs6ja9a3-OGpcrQg/exec",
  relayUrl: "https://script.google.com/macros/s/AKfycbwi_cSQgG9xA8D25YEyciXcrmnLhzljb3DhSt-ox1_pdCfGZzhmYFqs6ja9a3-OGpcrQg/exec",
  shareUrl: "https://chlrhkdwns12-boop.github.io/asan-union-download/app/",
  androiddownloadUrl: "https://chlrhkdwns12-boop.github.io/asan-union-download/"
};
