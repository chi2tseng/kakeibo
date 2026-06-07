# 記帳 · 騏 & 乖

福岡共同生活記帳網頁。資料即時讀取自 Google Sheet,免後端。

- **即時同步** — 前端直接讀 Google Sheet CSV,更新試算表後重整即更新(每 5 分鐘自動刷新)。
- **結算** — 自動計算誰要還誰多少,可一鍵排除「初期費用 / 語言學校」等大筆一次性支出避免失真。
- **分類 / 共同 vs 個人 / 月份趨勢** — 圖表視覺化,手機自適應。
- **明細** — 依日期 / 金額 / 類型排序,分類與共同個人篩選,關鍵字搜尋。

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
