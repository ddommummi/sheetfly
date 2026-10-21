import openpyxl, datetime
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import ColorScaleRule, CellIsRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.workbook.defined_name import DefinedName
wb = openpyxl.Workbook(); ws = wb.active; ws.title = '견적서'
thin = Side(style='thin', color='444444'); box = Border(left=thin,right=thin,top=thin,bottom=thin)
ws.merge_cells('A1:F1'); ws['A1'] = '견 적 서'; ws['A1'].font = Font(name='맑은 고딕', size=20, bold=True); ws['A1'].alignment = Alignment(horizontal='center', vertical='center'); ws.row_dimensions[1].height = 42
ws['A3'] = '견적일자'; ws['B3'] = datetime.date(2026,10,21); ws['B3'].number_format = 'yyyy"년" m"월" d"일"'
ws['D3'] = '수신'; ws['E3'] = '(주)한빛상사 귀중'
hdr = ['번호','품목','규격','수량','단가','공급가액']
for i,h in enumerate(hdr, start=1):
    c = ws.cell(row=5, column=i, value=h); c.font = Font(name='맑은 고딕', bold=True, color='FFFFFF'); c.fill = PatternFill('solid', fgColor='2F5597'); c.alignment = Alignment(horizontal='center'); c.border = box
items = [('노트북','15인치 i7',3,1450000),('모니터','27인치 QHD',5,320000),('키보드','무선 한글',10,45000),('마우스','블루투스',10,28000),('도킹스테이션','USB-C',3,189000)]
for r,(n,s,q,p) in enumerate(items, start=6):
    ws.cell(row=r,column=1,value=r-5); ws.cell(row=r,column=2,value=n); ws.cell(row=r,column=3,value=s); ws.cell(row=r,column=4,value=q); ws.cell(row=r,column=5,value=p)
    ws.cell(row=r,column=6,value=f'=D{r}*E{r}')
    for c in range(1,7):
        cell = ws.cell(row=r,column=c); cell.border = box
        if c in (5,6): cell.number_format = '#,##0"원"'
        if c in (1,4): cell.alignment = Alignment(horizontal='center')
ws['E11'] = '공급가액 합계'; ws['F11'] = '=SUM(F6:F10)'; ws['E12'] = '부가세(10%)'; ws['F12'] = '=ROUND(F11*0.1,0)'; ws['E13'] = '총 합계'; ws['F13'] = '=F11+F12'
for r in (11,12,13):
    ws.cell(row=r,column=6).number_format = '#,##0"원"'; ws.cell(row=r,column=5).font = Font(bold=True); ws.cell(row=r,column=6).font = Font(bold=True)
ws['A15'] = '금액(한글)'; ws['B15'] = '=TEXT(F13,"#,##0")&"원정"'
ws['A16'] = '비고'; ws.merge_cells('B16:F18'); ws['B16'] = '납기: 발주 후 7일 이내\n결제: 월말 현금 결제\n유효기간: 견적일로부터 30일'; ws['B16'].alignment = Alignment(wrap_text=True, vertical='top')
for col,w in zip('ABCDEF',(8,16,16,8,14,16)): ws.column_dimensions[col].width = w
ws.freeze_panes = 'A6'
ws.conditional_formatting.add('F6:F10', ColorScaleRule(start_type='min', start_color='FFFFFF', end_type='max', end_color='F8CBAD'))
ws.conditional_formatting.add('D6:D10', CellIsRule(operator='greaterThan', formula=['5'], font=Font(color='C00000', bold=True)))
dv = DataValidation(type='list', formula1='"견적,발주,완료"', allow_blank=True); ws.add_data_validation(dv); dv.add('B20'); ws['A20']='상태'; ws['B20']='견적'
ws.print_area = 'A1:F18'; ws.page_setup.orientation = 'portrait'; ws.page_setup.fitToWidth = 1
wb.defined_names['부가세율'] = DefinedName('부가세율', attr_text="'견적서'!$F$12")
s2 = wb.create_sheet('월별매출'); s2.append(['월','영업1팀','영업2팀','합계'])
for m in range(1,13): s2.append([f'{m}월', 1000000+m*130000, 900000+m*95000, f'=B{m+1}+C{m+1}'])
s2['A15']='연간'; s2['D15']='=SUM(D2:D13)'; s2['D15'].number_format='#,##0'
for r in range(2,14):
    for c in 'BCD': s2[f'{c}{r}'].number_format = '#,##0'
ch = BarChart(); ch.type='col'; ch.title='월별 매출'; ch.add_data(Reference(s2, min_col=2, min_row=1, max_col=3, max_row=13), titles_from_data=True); ch.set_categories(Reference(s2, min_col=1, min_row=2, max_row=13)); ch.height=8; ch.width=16; s2.add_chart(ch, 'F2')
wb.save('korean.xlsx')
