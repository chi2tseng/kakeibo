# 記帳 · 騏 & 乖

福岡共同生活記帳網頁。資料即時讀取自 Google Sheet,免後端。

- **即時同步** — 前端直接讀 Google Sheet CSV,更新試算表後重整即更新(每 5 分鐘自動刷新)。
- **總覽** — 總額、結算、本月配速、變動累計曲線、分類前五、最近 5 筆。
- **結算** — 誰要還誰多少、共同支出誰墊的、每個人花在哪(全部 / 共同 / 個人);可一鍵排除「初期費用 / 語言學校」等大筆一次性支出。
- **明細** — 每月長條(點月份切換)、分類組成(點分類篩選)、搜尋、排序、清單 / 收據照片牆;點任一筆看收據大圖與品項。
- **收據照片** — LINE 記帳機器人把原圖存到 GCS,網址寫在試算表 H 欄(純文字);縮圖在同 bucket 的 `t/` 路徑。

新增 Material Symbols 圖示時,要把名稱加進 `index.html` 字型網址的 `icon_names`(字母排序),否則會顯示成英文字。

## 技術

純靜態:`index.html` + `css/styles.css` + `js/lib.js`(資料與計算)+ `js/app.js`(介面)。
相依:[Chart.js](https://www.chartjs.org/)、[PapaParse](https://www.papaparse.com/)、Material Symbols、Inter。
設計:Wise 風格規範。

## 開發

```
python -m http.server 5599
```

開 http://localhost:5599

> 試算表需設為「知道連結的任何人 → 檢視者」,網頁才讀得到。
