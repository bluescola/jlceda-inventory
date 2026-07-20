# Order import format

The extension accepts UTF-8 CSV and JSON. There is no public JLC order API in the current Professional V3 extension API, so users export or prepare a file before importing.

## CSV example

```csv
C编号,商品名称,数量,大概数量,是否用完,仓位,备注
C25804,10k 电阻,100,否,否,A-01,0603
C12345,1uF 电容,20,是,是,B-02,已全部使用
```

## JSON example

```json
[
	{
		"LCSC Part #": "C25804",
		"Name": "10k resistor",
		"Qty": 100,
		"Status": "in-stock",
		"Location": "A-01"
	}
]
```

Recognized fields include Chinese and English aliases for:

- LCSC / supplier part number
- component name
- quantity
- manufacturer and manufacturer part number
- package / footprint
- exact or estimated quantity
- depleted / used-up state
- storage location and note

Rows can set `是否用完` / `Status` individually. When a row has no state column, the import dialog applies the selected default. Duplicate parts are matched by C number first, then manufacturer plus manufacturer part number, then name; the user chooses add, replace, or skip before import.
