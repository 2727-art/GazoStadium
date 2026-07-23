// Firebase の Web 設定値はクライアント識別用であり、秘密鍵ではありません。
// 実際のアクセス制御は Realtime Database の security rules で行います。
export const FIREBASE_SDK_VERSION = "12.16.0";

export const firebaseConfig = {
  apiKey: "AIzaSyBJ6XY3fYNKIXrmz-TK7GztiWPG0wPIELk",
  authDomain: "gazostadium.firebaseapp.com",
  databaseURL: "https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "gazostadium",
  storageBucket: "gazostadium.firebasestorage.app",
  messagingSenderId: "70245106641",
  appId: "1:70245106641:web:722ceea8805a7b11b8d6f0",
};

// Firebase ConsoleでWebアプリをApp Check（reCAPTCHA Enterprise）へ登録後、
// 発行されたサイトキーを設定します。未設定時はApp Checkを初期化しません。
export const appCheckRecaptchaEnterpriseSiteKey = "6LfAyWAtAAAAAEi4dthTKvY50auKt2BT5SdGi7hh";
