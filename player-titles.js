export const PLAYER_TITLE_CATEGORIES = Object.freeze([
  { id: "preference", label: "好きなもの", eyebrow: "FAVORITES", icon: "♥", className: "title-category-preference", description: "好きな被写体やジャンルを伝える称号" },
  { id: "expression", label: "画像表現", eyebrow: "IMAGE STYLE", icon: "✦", className: "title-category-expression", description: "構図・色・撮影へのこだわりを表す称号" },
  { id: "solo", label: "通常型1on1", eyebrow: "STANDARD 1ON1", icon: "◎", className: "title-category-solo", description: "純粋な画像勝負を楽しむプレイヤー向け称号" },
  { id: "strategy", label: "戦略型1on1", eyebrow: "STRATEGY 1ON1", icon: "?", className: "title-category-strategy", description: "推理・ブラフ・追撃を楽しむプレイヤー向け称号" },
  { id: "multiplayer", label: "2on2・ロワイヤル", eyebrow: "MULTIPLAYER", icon: "∞", className: "title-category-multiplayer", description: "連携や生き残りを楽しむプレイヤー向け称号" },
  { id: "community", label: "交流・ネタ", eyebrow: "COMMUNITY", icon: "☺", className: "title-category-community", description: "チャットや画像収集の個性を気軽に表す称号" },
  { id: "oshi_market", label: "推し活・ときめき", eyebrow: "OSHI MARKET", icon: "♡", className: "title-category-oshi-market", description: "推し値市場で店主の個性や得意を伝える称号", collection: "oshi_market" },
]);

export const PLAYER_TITLE_PRODUCTS = Object.freeze([
  { id: "title_plant_lover", type: "title", name: "植物愛好家", title: "植物愛好家", description: "植物画像が好きなことを伝える称号", price: 450, category: "preference" },
  { id: "title_animal_lover", type: "title", name: "どうぶつ派", title: "どうぶつ派", description: "動物画像が好きなことを伝える称号", price: 450, category: "preference" },
  { id: "title_landscape_hunter", type: "title", name: "風景ハンター", title: "風景ハンター", description: "印象的な景色を探すプレイヤー向け称号", price: 500, category: "preference" },
  { id: "title_live_action_supremacy", type: "title", name: "実写至上主義", title: "実写至上主義", description: "写真ならではの一瞬を愛するプレイヤー向け称号", price: 500, category: "preference" },
  { id: "title_2d_lover", type: "title", name: "二次元愛好家", title: "二次元愛好家", description: "イラストやアニメ画像への愛を示す称号", price: 500, category: "preference" },
  { id: "title_mushroom_side", type: "title", name: "きのこ派", title: "きのこ派", description: "終わらないお菓子論争で、きのこを選ぶ称号", price: 400, category: "preference" },
  { id: "title_bamboo_side", type: "title", name: "たけのこ派", title: "たけのこ派", description: "終わらないお菓子論争で、たけのこを選ぶ称号", price: 400, category: "preference" },
  { id: "title_mostly_cats", type: "title", name: "だいたい猫", title: "だいたい猫", description: "気づけば猫画像を選んでいる人の称号", price: 450, category: "preference" },
  { id: "title_dog_soft_spot", type: "title", name: "犬にも弱い", title: "犬にも弱い", description: "犬画像を見るとつい高得点をつけてしまう人の称号", price: 450, category: "preference" },
  { id: "title_bird_spotter", type: "title", name: "鳥を見逃さない", title: "鳥を見逃さない", description: "画面のどこにいても鳥を見つける人の称号", price: 450, category: "preference" },
  { id: "title_sky_watcher", type: "title", name: "空ばかり見てる", title: "空ばかり見てる", description: "雲や青空の一瞬を集め続ける人の称号", price: 450, category: "preference" },
  { id: "title_night_view_collector", type: "title", name: "夜景収集家", title: "夜景収集家", description: "街の灯りと夜の色を集める人の称号", price: 500, category: "preference" },
  { id: "title_sweet_tooth_camera", type: "title", name: "甘党カメラ", title: "甘党カメラ", description: "スイーツ画像を優先してしまう人の称号", price: 450, category: "preference" },

  { id: "title_image_sommelier", type: "title", name: "画像ソムリエ", title: "画像ソムリエ", description: "画像の魅力をじっくり味わう上級称号", price: 650, category: "expression" },
  { id: "title_blur_connoisseur", type: "title", name: "ピンぼけ鑑定士", title: "ピンぼけ鑑定士", description: "少しくらいのぼけにも味を見つける称号", price: 400, category: "expression" },
  { id: "title_resolution_is_justice", type: "title", name: "解像度は正義", title: "解像度は正義", description: "細部までくっきり見届けたい人の称号", price: 500, category: "expression" },
  { id: "title_composition_lost", type: "title", name: "構図迷子", title: "構図迷子", description: "正解を探しながら今日も画像を選ぶ称号", price: 350, category: "expression" },
  { id: "title_color_collector", type: "title", name: "色彩コレクター", title: "色彩コレクター", description: "心に残る色の組み合わせを集める人の称号", price: 550, category: "expression" },
  { id: "title_light_shadow_resident", type: "title", name: "光と影の住人", title: "光と影の住人", description: "光と影が生むドラマを愛する人の称号", price: 600, category: "expression" },
  { id: "title_negative_space_lover", type: "title", name: "余白愛好家", title: "余白愛好家", description: "静かな余白まで作品として味わう人の称号", price: 500, category: "expression" },
  { id: "title_symmetry_side", type: "title", name: "シンメトリー派", title: "シンメトリー派", description: "左右対称の気持ちよさを見逃さない人の称号", price: 500, category: "expression" },
  { id: "title_waiting_miracle_shot", type: "title", name: "奇跡の一枚待ち", title: "奇跡の一枚待ち", description: "偶然が重なる最高の瞬間を待つ人の称号", price: 550, category: "expression" },

  { id: "title_good_praiser", type: "title", name: "ほめ上手", title: "ほめ上手", description: "相手の魅力を見つけるプレイヤー向け称号", price: 400, category: "solo" },
  { id: "title_intuition_ten", type: "title", name: "直感で10点", title: "直感で10点", description: "刺さった瞬間の気持ちを素直に採点する称号", price: 650, category: "solo" },
  { id: "title_speak_in_images", type: "title", name: "画像で語る", title: "画像で語る", description: "言葉より一枚の画像で勝負する人の称号", price: 500, category: "solo" },
  { id: "title_first_impression", type: "title", name: "第一印象重視", title: "第一印象重視", description: "最初に感じた魅力を大切にする人の称号", price: 450, category: "solo" },
  { id: "title_scoring_with_love", type: "title", name: "採点は愛", title: "採点は愛", description: "点数にも相手への敬意を込める人の称号", price: 500, category: "solo" },
  { id: "title_five_card_match", type: "title", name: "5枚勝負", title: "5枚勝負", description: "選び抜いた5枚で正面から挑む人の称号", price: 550, category: "solo" },

  { id: "title_weakness_detective", type: "title", name: "弱点捜索中", title: "弱点捜索中", description: "相手の本当の弱点を静かに探る人の称号", price: 600, category: "strategy" },
  { id: "title_bluff_loaded", type: "title", name: "ブラフ仕込み中", title: "ブラフ仕込み中", description: "自己紹介に読み合いの種を忍ばせる人の称号", price: 550, category: "strategy" },
  { id: "title_clue_collecting", type: "title", name: "手掛かり収集中", title: "手掛かり収集中", description: "画像・音声・会話の反応を見逃さない人の称号", price: 500, category: "strategy" },
  { id: "title_pursuit_ready", type: "title", name: "追撃準備完了", title: "追撃準備完了", description: "弱点看破後の怒涛の追撃を準備する称号", price: 700, category: "strategy" },
  { id: "title_deck_building", type: "title", name: "デッキ構築中", title: "デッキ構築中", description: "相手に刺さる画像の組み合わせを考える人の称号", price: 550, category: "strategy" },

  { id: "title_team_link_active", type: "title", name: "TEAM LINK中", title: "TEAM LINK中", description: "相方との連携を楽しむプレイヤー向け称号", price: 600, category: "multiplayer" },
  { id: "title_trust_my_partner", type: "title", name: "相方を信じる", title: "相方を信じる", description: "最後までチームメイトを信じて戦う人の称号", price: 550, category: "multiplayer" },
  { id: "title_combo_romance", type: "title", name: "連携はロマン", title: "連携はロマン", description: "2枚が噛み合う瞬間を愛する人の称号", price: 600, category: "multiplayer" },
  { id: "title_last_image", type: "title", name: "最後の一枚", title: "最後の一枚", description: "勝負を決める切り札を最後まで残す人の称号", price: 650, category: "multiplayer" },
  { id: "title_still_surviving", type: "title", name: "ただいま生存中", title: "ただいま生存中", description: "バトルロワイヤルを最後まで楽しむ人の称号", price: 550, category: "multiplayer" },

  { id: "title_hariai_master", type: "title", name: "貼り合いマスター", title: "貼り合いマスター", description: "貼り合いを遊び込んだコレクション称号", price: 900, category: "community" },
  { id: "title_image_folder_guardian", type: "title", name: "画像フォルダの守護者", title: "画像フォルダの守護者", description: "大切な画像コレクションを見守る者の称号", price: 450, category: "community" },
  { id: "title_cant_pick_five", type: "title", name: "5枚に絞れない", title: "5枚に絞れない", description: "候補画像が多すぎて毎回悩む人の称号", price: 350, category: "community" },
  { id: "title_food_photo_alert", type: "title", name: "飯テロ警戒中", title: "飯テロ警戒中", description: "空腹時の食べ物画像に備えるための称号", price: 450, category: "community" },
  { id: "title_subjective_today", type: "title", name: "今日も主観", title: "今日も主観", description: "採点は主観、それも含めて楽しむ上位ネタ称号", price: 600, category: "community" },
  { id: "title_comments_keep_coming", type: "title", name: "感想が止まらない", title: "感想が止まらない", description: "好きな画像への感想が次々と浮かぶ人の称号", price: 450, category: "community" },
  { id: "title_silent_high_score", type: "title", name: "無言の高評価", title: "無言の高評価", description: "多くを語らず点数で魅力を伝える人の称号", price: 500, category: "community" },
  { id: "title_words_lost", type: "title", name: "語彙力消失中", title: "語彙力消失中", description: "刺さる画像を前に言葉を失った人の称号", price: 400, category: "community" },
  { id: "title_deep_folder", type: "title", name: "フォルダが深い", title: "フォルダが深い", description: "目的の画像まで何階層も潜る人の称号", price: 450, category: "community" },
  { id: "title_too_many_favorites", type: "title", name: "推しが多すぎる", title: "推しが多すぎる", description: "好きなものをひとつに決められない人の称号", price: 500, category: "community" },

  { id: "title_oshi_deliverer", type: "title", name: "推しを届ける人", title: "推しを届ける人", description: "大切な一枚を、買い手へ丁寧に届ける店主の称号", price: 400, category: "oshi_market", collection: "oshi_market" },
  { id: "title_oshi_storyteller", type: "title", name: "推し語り係", title: "推し語り係", description: "画像の好きなところを言葉で伝える店主の称号", price: 450, category: "oshi_market", collection: "oshi_market" },
  { id: "title_tokimeki_scout", type: "title", name: "ときめき発掘隊", title: "ときめき発掘隊", description: "まだ知られていない魅力を見つけ出す店主の称号", price: 450, category: "oshi_market", collection: "oshi_market" },
  { id: "title_one_picture_guide", type: "title", name: "一枚の案内人", title: "一枚の案内人", description: "買い手の好みに寄り添って一枚を案内する店主の称号", price: 500, category: "oshi_market", collection: "oshi_market" },
  { id: "title_favorite_matchmaker", type: "title", name: "好きの仲人", title: "好きの仲人", description: "画像と買い手の「好き」を結びつける店主の称号", price: 550, category: "oshi_market", collection: "oshi_market" },
  { id: "title_tokimeki_curator", type: "title", name: "ときめきキュレーター", title: "ときめきキュレーター", description: "心が動く一枚を選び抜いて並べる店主の称号", price: 650, category: "oshi_market", collection: "oshi_market" },
  { id: "title_oshi_concierge", type: "title", name: "推し値コンシェルジュ", title: "推し値コンシェルジュ", description: "店の個性とおもてなしを磨き続ける店主の称号", price: 750, category: "oshi_market", collection: "oshi_market" },
]);

const PLAYER_TITLE_BY_ID = new Map(PLAYER_TITLE_PRODUCTS.map((product) => [product.id, product]));
const PLAYER_TITLE_CATEGORY_BY_ID = new Map(PLAYER_TITLE_CATEGORIES.map((category) => [category.id, category]));

export function getPlayerTitleProduct(titleId) {
  return PLAYER_TITLE_BY_ID.get(String(titleId || "")) || null;
}

export function getPlayerTitleCategory(categoryId) {
  return PLAYER_TITLE_CATEGORY_BY_ID.get(String(categoryId || "")) || null;
}

export function getPlayerTitlePresentation(titleId) {
  const product = getPlayerTitleProduct(titleId);
  const category = product ? getPlayerTitleCategory(product.category) : null;
  return product && category
    ? { product, category, icon: category.icon, className: category.className }
    : null;
}
