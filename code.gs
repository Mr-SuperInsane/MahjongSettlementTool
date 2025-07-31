// スプレッドシートのIDをスクリプトプロパティから取得
const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
const SUMMARY_SHEET_NAME = '累計収支サマリー';
const LOG_SHEET_NAME = '収支ログ';

/**
 * ウェブアプリとしてPOSTリクエストを受け取るメイン関数
 * @param {object} e - イベントオブジェクト
 * @returns {ContentService.TextOutput} - 処理結果のJSON
 */
function doPost(e) {
  try {
    // リクエストボディをパース
    const requestData = JSON.parse(e.postData.contents);
    const { players, ratePoint, rateYen, sanma, webhookUrl, gasApiUrl } = requestData;

    // 入力データ検証
    if (!players || players.length < 3 || !ratePoint || !rateYen || !webhookUrl) {
      throw new Error('無効なリクエストデータです。');
    }

    // スプレッドシートを開く
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (!ss) {
      throw new Error(`スプレッドシートが見つかりません。ID: ${SPREADSHEET_ID}`);
    }
    const summarySheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
    const logSheet = ss.getSheetByName(LOG_SHEET_NAME);

    if (!summarySheet || !logSheet) {
      throw new Error(`シート「${SUMMARY_SHEET_NAME}」または「${LOG_SHEET_NAME}」が見つかりません。`);
    }

    // 収支を計算
    const settlement = calculateSettlement(players, ratePoint, rateYen, sanma);

    // スプレッドシートを更新し、更新後の累計収支を取得
    const updatedTotals = updateSpreadsheet(ss, settlement);

    // Discordに通知
    sendToDiscord(webhookUrl, settlement, updatedTotals);

    // 成功レスポンスを返す
    return createJsonResponse({ status: 'success', message: '精算結果を記録し、Discordに通知しました。' });

  } catch (error) {
    // エラーログを記録
    console.error(`エラー発生: ${error.message}\nスタックトレース: ${error.stack}`);
    // エラーレスポンスを返す
    return createJsonResponse({ status: 'error', message: `サーバー側でエラーが発生しました: ${error.message}` });
  }
}

/**
 * 点数に基づいて収支を計算する
 * @param {Array<object>} players - プレイヤー情報の配列
 * @param {number} ratePoint - レートの点数
 * @param {number} rateYen - レートの金額
 * @param {boolean} sanma - 3位が2位に支払うかどうかのフラグ
 * @returns {Array<object>} - 計算後の収支情報を含むプレイヤー配列
 */
function calculateSettlement(players, ratePoint, rateYen, sanma) {
  // 点数で降順にソート
  const sortedPlayers = players.sort((a, b) => b.score - a.score);
  const settlementResult = sortedPlayers.map(p => ({ ...p, amount: 0 }));

  const p1 = settlementResult[0];
  const p2 = settlementResult[1];
  const p3 = settlementResult[2];
  const p4 = settlementResult.length === 4 ? settlementResult[3] : null;

  // 4人麻雀の場合
  if (p4) {
    // 1位と4位の精算
    const amount1_4 = Math.floor((p1.score - p4.score) / ratePoint) * rateYen;
    p1.amount += amount1_4;
    p4.amount -= amount1_4;

    // 2位と3位の精算（チェックボックスがオンの場合）
    if (sanma) {
      const amount2_3 = Math.floor((p2.score - p3.score) / ratePoint) * rateYen;
      p2.amount += amount2_3;
      p3.amount -= amount2_3;
    }
  }
  // 3人麻雀の場合
  else {
    const amount1_3 = Math.floor((p1.score - p3.score) / ratePoint) * rateYen;
    p1.amount += amount1_3;
    p3.amount -= amount1_3;
    // 2位は変動なし
  }

  return settlementResult;
}

/**
 * スプレッドシートを更新する
 * @param {Spreadsheet} ss - スプレッドシートオブジェクト
 * @param {Array<object>} settlement - 計算後の収支情報
 * @returns {Object} - ユーザーIDをキーとした更新後の累計収支オブジェクト
 */
function updateSpreadsheet(ss, settlement) {
  const summarySheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
  const logSheet = ss.getSheetByName(LOG_SHEET_NAME);

  // 累計収支シートのデータを取得
  const summaryData = summarySheet.getRange(2, 1, summarySheet.getLastRow(), 3).getValues();
  const summaryMap = new Map(summaryData.map(row => [row[1].toString(), { row: summaryData.indexOf(row) + 2, total: row[2] }]));

  const updatedTotals = {};

  // 今回の収支を累計に反映
  settlement.forEach(player => {
    const discordId = player.id.toString();
    if (summaryMap.has(discordId)) {
      const summaryInfo = summaryMap.get(discordId);
      const newTotal = summaryInfo.total + player.amount;
      summarySheet.getRange(summaryInfo.row, 3).setValue(newTotal);
      updatedTotals[discordId] = newTotal;
    } else {
      // 累計シートにユーザーが存在しない場合は追加
      summarySheet.appendRow([player.name, discordId, player.amount]);
      updatedTotals[discordId] = player.amount;
    }
  });

  // 収支ログシートに記録
  const logRow = [new Date()];
  settlement.forEach(player => {
    logRow.push(player.name, player.score, player.amount);
  });
  logSheet.appendRow(logRow);

  return updatedTotals;
}

/**
 * Discordに精算結果を通知する
 * @param {string} webhookUrl - DiscordのWebhook URL
 * @param {Array<object>} settlement - 今回の収支情報
 * @param {Object} updatedTotals - 更新後の累計収支
 */
function sendToDiscord(webhookUrl, settlement, updatedTotals) {
  const now = new Date();
  const dateString = Utilities.formatDate(now, 'JST', 'yyyy年MM月dd日 HH:mm');

  const fields = settlement.map((player, index) => {
    const discordId = player.id.toString();
    const currentAmount = player.amount >= 0 ? `+${player.amount.toLocaleString()}` : player.amount.toLocaleString();
    const totalAmount = updatedTotals[discordId] ? updatedTotals[discordId].toLocaleString() : '0';
    
    let value = `**${currentAmount}円** (累計: ${totalAmount}円)`;
    if (settlement.length === 3 && index === 1) {
        value = `**変動なし** (累計: ${totalAmount}円)`
    }

    return {
      name: `${index + 1}. **[${player.name}]**`,
      value: value,
      inline: false,
    };
  });

  const payload = {
    embeds: [{
      title: '🀄 麻雀 精算結果',
      description: `**${dateString}**`,
      color: 0x4CAF50, // 緑色
      fields: fields,
      footer: {
        text: 'Powered by INSANE',
      },
    }],
  };

  const params = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
  };

  UrlFetchApp.fetch(webhookUrl, params);
}

/**
 * JSONレスポンスを生成するヘルパー関数
 * @param {object} obj - レスポンスオブジェクト
 * @returns {ContentService.TextOutput}
 */
function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
