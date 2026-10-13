param([string]$BuyerPin,[Parameter(Mandatory=$true)][string]$TaxpayerPin,[string]$BranchId='01',[int]$InvoiceId=-1,[Parameter(Mandatory=$true)][string]$InstallationDir,[Parameter(Mandatory=$true)][string]$DatabasePath)
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
. "$PSScriptRoot\tools\readonly-client-db.ps1" -InstallationDir $InstallationDir -DatabasePath $DatabasePath
function Read-Rows([string]$Sql){
 $c=$conn.CreateCommand();$c.CommandText=$Sql
 foreach($entry in @{buyer=$BuyerPin;tin=$TaxpayerPin;branch=$BranchId;invoice=$InvoiceId}.GetEnumerator()){
  [void]$c.Parameters.AddWithValue(('@'+$entry.Key),$entry.Value)
 }
 $r=$c.ExecuteReader();$rows=@()
 try{while($r.Read()){$row=[ordered]@{};for($i=0;$i -lt $r.FieldCount;$i++){$v=$r.GetValue($i);$row[$r.GetName($i)]=if($v -is [DBNull]){$null}else{$v}};$rows+=[pscustomobject]$row}}finally{$r.Dispose();$c.Dispose()}
 return ,$rows
}
try{
 $conn.Open();$c=$conn.CreateCommand();$c.CommandText='PRAGMA query_only=ON';[void]$c.ExecuteNonQuery();$c.Dispose()
 $devices=Read-Rows 'SELECT DISTINCT TIN,BHF_ID FROM TAXPAYER_BHF_DEVICE_USER'
 $customers=Read-Rows 'SELECT CUST_TIN,CUST_NM,CONTACT1,EMAIL,RM FROM TAXPAYER_BHF_CUST WHERE TIN=@tin AND BHF_ID=@branch AND CUST_TIN=@buyer AND USE_YN=''Y'''
 $items=Read-Rows 'SELECT i.ITEM_CD,i.ITEM_NM,i.ITEM_CLS_CD,i.ITEM_TY_CD,i.ORGN_NAT_CD,i.PKG_UNIT_CD,i.QTY_UNIT_CD,i.TAX_TY_CD,i.DFT_PRC,i.INITL_WH_UNTPC,i.EXPIRATION_YN,i.USE_YN,coalesce(s.RSD_QTY,0) AS RSD_QTY FROM TAXPAYER_ITEM i LEFT JOIN STOCK_MASTER s ON s.TIN=i.TIN AND s.ITEM_CD=i.ITEM_CD AND s.BHF_ID=@branch WHERE i.TIN=@tin'
 $sales=Read-Rows 'SELECT INVC_NO,CUST_TIN,CUST_NM,SALES_STTS_CD,SALES_DT,CFM_DT,PMT_TY_CD,TOT_AMT,TOT_TAX_AMT,REMARK FROM TRNS_SALE WHERE TIN=@tin AND BHF_ID=@branch AND INVC_NO=@invoice'
 $lines=Read-Rows 'SELECT ITEM_CD,ITEM_NM,QTY,PRC,TAX_TY_CD,TOT_AMT FROM TRNS_SALE_ITEM WHERE TIN=@tin AND BHF_ID=@branch AND INVC_NO=@invoice ORDER BY ITEM_SEQ'
 $receipts=Read-Rows 'SELECT INVC_NO,CUR_RCPT_NO,TOT_RCPT_NO,RCPT_PBCT_DT,RCPT_SIGN,JRNL FROM TRNS_SALE_RECEIPT WHERE TIN=@tin AND BHF_ID=@branch AND INVC_NO=@invoice'
 foreach($receipt in $receipts){
  $cu=[regex]::Match([string]$receipt.JRNL,'CU Invoice No\.:\s*([A-Z0-9]+/\d+)').Groups[1].Value
  $scu=[regex]::Match([string]$receipt.JRNL,'SCU ID\s*:\s*([A-Z0-9]+)').Groups[1].Value
  $receipt.PSObject.Properties.Remove('JRNL')
  $receipt|Add-Member -NotePropertyName CU_INVOICE_NUMBER -NotePropertyValue $cu
  $receipt|Add-Member -NotePropertyName SCU_ID -NotePropertyValue $scu
 }
 $c=$conn.CreateCommand();$c.CommandText='SELECT coalesce(max(INVC_NO),0) FROM TRNS_SALE WHERE TIN=@tin AND BHF_ID=@branch';[void]$c.Parameters.AddWithValue('@tin',$TaxpayerPin);[void]$c.Parameters.AddWithValue('@branch',$BranchId);$max=$c.ExecuteScalar();$c.Dispose()
 $default=@(Get-CimInstance Win32_Printer|Where-Object {$_.Default}|Select-Object -ExpandProperty Name)
 $app=@(Get-Process -Name 'EBM2x.WPF' -ErrorAction SilentlyContinue|Select-Object -ExpandProperty Id)
 $codes=Read-Rows 'SELECT CD_CLS,CD,CD_NM FROM CODE_DTL WHERE USE_YN=''Y'''
 $classes=Read-Rows 'SELECT ITEM_CLS_CD,ITEM_CLS_NM FROM ITEM_CLASS WHERE USE_YN=''Y'''
 [pscustomobject]@{registered_devices=@($devices);customers=@($customers);items=@($items);sales=@($sales);lines=@($lines);receipts=@($receipts);codes=@($codes);classes=@($classes);max_invoice=[int]$max;default_printer=$default;process_ids=$app}|ConvertTo-Json -Depth 5 -Compress
}finally{$conn.Dispose()}
