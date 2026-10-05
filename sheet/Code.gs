// 구글 시트의 '확장 프로그램 > Apps Script'에 통째로 붙여 넣는다.
function doPost(e) {
  var r = JSON.parse(e.postData.contents);
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sh.getLastRow() === 0) {
    sh.appendRow(["제출시각", "이름", "난이도", "문항수", "점수", "푼 문항수", "틀린 문항 번호", "걸린 시간(초)", "시간종료"]);
  }
  sh.appendRow([r.time, r.name, r.level, r.total, r.score, r.solved, r.wrong, r.seconds, r.timedOut]);
  return ContentService.createTextOutput("ok");
}
