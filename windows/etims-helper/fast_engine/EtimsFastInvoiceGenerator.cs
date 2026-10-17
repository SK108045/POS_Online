using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SQLite;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web;
using EBM2x.Database.Master;
using EBM2x.Modules;
using EBM2x.Utils;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace EtimsProgrammatic
{
    public class InvoiceItemInput
    {
        public string ItemCode { get; set; }
        public string Name { get; set; }
        public double Quantity { get; set; }
        public double UnitPrice { get; set; }
        public double SupplyAmount { get; set; }
        public double DiscountRate { get; set; }
        public double DiscountAmount { get; set; }
        public double LineTotal { get; set; }
        public string TaxCode { get; set; }
    }

    public class InvoiceRequest
    {
        public string BuyerPin { get; set; }
        public string BuyerName { get; set; }
        public string BuyerPhone { get; set; }
        public string BuyerEmail { get; set; }
        public string BuyerAddress { get; set; }
        public List<InvoiceItemInput> Items { get; set; }
        public string PaymentCode { get; set; } // "01" = Cash, "06" = Mobile Money
        public string Remark { get; set; }
        public string PosSaleDigest { get; set; }
    }

    public class QrCodeInfo
    {
        public string Image { get; set; }
        public string Payload { get; set; }
        public string Sha256 { get; set; }
        public string Source { get; set; }
    }

    public class InvoiceResult
    {
        public bool Success { get; set; }
        public long LocalInvoiceId { get; set; }
        public string InvoiceNumber { get; set; }
        public string CuInvoiceNumber { get; set; }
        public string ScuId { get; set; }
        public string ReceiptSignature { get; set; }
        public string ReceiptSignatureFormatted { get; set; }
        public string InternalData { get; set; }
        public string InvoiceDate { get; set; }
        public QrCodeInfo QrCode { get; set; }
        public string PdfSha256 { get; set; }
        public double TotalAmount { get; set; }
        public long ExecutionMs { get; set; }
        public string Error { get; set; }
    }

    public class Generator
    {
        private string _installationDir;
        private string _dbPath;
        private string _outboxDir;
        private string _outputDir;
        private string _connString;
        private string _tin;
        private string _branchId;
        private string _scuId;
        private string _mrcCode;
        private string _signKey;
        private string _aesPassword;
        private string _taxpayerName;
        private string _userNm;
        private string _userId;
        private string _address;

        public Generator(string installationDir, string dbPath, string outboxDir, string outputDir)
        {
            _installationDir = !string.IsNullOrEmpty(installationDir)
                ? installationDir
                : @"C:\eTIMS-Paypoint-Win";

            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            _dbPath = !string.IsNullOrEmpty(dbPath)
                ? dbPath
                : Path.Combine(localAppData, "EBM2x", "sqlite", "RRA_EBM2x.db");

            _outboxDir = !string.IsNullOrEmpty(outboxDir)
                ? outboxDir
                : Path.Combine(localAppData, "EBM2x", "rrasdc", "transaction");

            _outputDir = !string.IsNullOrEmpty(outputDir)
                ? outputDir
                : Path.Combine(localAppData, "OraforgePOS", "etims", "invoices");

            if (!Directory.Exists(_outputDir))
            {
                Directory.CreateDirectory(_outputDir);
            }

            _connString = "Data Source=" + _dbPath + "; Version=3; Password=EBMCLIENT-20170301-GAION; Pooling=False;";
            _aesPassword = Common.AES256Password();

            LoadSetup();
        }

        private void LoadSetup()
        {
            string dbDir = Path.GetDirectoryName(_dbPath);
            string rrasdcPath = Path.Combine(dbDir, "RRA_EBM2x.db.RraSdc");
            if (!File.Exists(rrasdcPath))
            {
                rrasdcPath = _dbPath + ".RraSdc";
            }

            if (File.Exists(rrasdcPath))
            {
                using (var fs = new FileStream(rrasdcPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    fs.Seek(6100, SeekOrigin.Begin);
                    byte[] lenBuf = new byte[20];
                    fs.Read(lenBuf, 0, 20);
                    int jsonLen = int.Parse(Encoding.ASCII.GetString(lenBuf).Trim());

                    fs.Seek(6200, SeekOrigin.Begin);
                    byte[] dataBuf = new byte[jsonLen];
                    fs.Read(dataBuf, 0, jsonLen);
                    string urlEncoded = Encoding.ASCII.GetString(dataBuf);
                    string decodedJson = HttpUtility.UrlDecode(urlEncoded, Encoding.UTF8);

                    JObject setup = JObject.Parse(decodedJson);
                    _tin = (string)setup["GblTaxIdNo"];
                    _branchId = (string)setup["GblBrcCod"];
                    if (string.IsNullOrEmpty(_branchId)) _branchId = "01";
                    _scuId = (string)setup["GblSdcSysNum"];
                    _mrcCode = (string)setup["GblMrcSysCod"];
                    _signKey = (string)setup["GblKeySign"];
                    _taxpayerName = (string)setup["GblTaxIdNm"];
                    if (string.IsNullOrEmpty(_taxpayerName)) _taxpayerName = "Taxpayer";
                    _userNm = "John Wakaba";
                    _userId = "john01";
                    _address = "Nairobi Starehe District CBD";
                }
            }
            else
            {
                throw new InvalidOperationException("eTIMS device data (RRA_EBM2x.db.RraSdc) was not found on this PC. Install and register the eTIMS client for this taxpayer first.");
            }

            // Query dynamic user info and business address from DB if available
            try
            {
                using (var conn = new SQLiteConnection(_connString))
                {
                    conn.Open();
                    using (var cmd = conn.CreateCommand())
                    {
                        cmd.CommandText = "SELECT USER_ID, USER_NM FROM TAXPAYER_BHF_USER WHERE USE_YN='Y' LIMIT 1;";
                        using (var r = cmd.ExecuteReader())
                        {
                            if (r.Read())
                            {
                                string uid = r["USER_ID"] != DBNull.Value ? r["USER_ID"].ToString().Trim() : "";
                                string unm = r["USER_NM"] != DBNull.Value ? r["USER_NM"].ToString().Trim() : "";
                                if (!string.IsNullOrEmpty(uid)) _userId = uid;
                                if (!string.IsNullOrEmpty(unm)) _userNm = unm;
                            }
                        }
                    }

                    using (var cmd = conn.CreateCommand())
                    {
                        cmd.CommandText = "SELECT TAXPR_NM, ADRS FROM TAXPAYER_INFO LIMIT 1;";
                        using (var r = cmd.ExecuteReader())
                        {
                            if (r.Read())
                            {
                                string tnm = r["TAXPR_NM"] != DBNull.Value ? r["TAXPR_NM"].ToString().Trim() : "";
                                string adr = r["ADRS"] != DBNull.Value ? r["ADRS"].ToString().Trim() : "";
                                if (!string.IsNullOrEmpty(tnm)) _taxpayerName = tnm;
                                if (!string.IsNullOrEmpty(adr)) _address = adr;
                            }
                        }
                    }
                }
            }
            catch
            {
                // Fallback values from RraSdc are already populated
            }
        }

        private class ResolvedItem
        {
            public int Seq { get; set; }
            public string ItemCode { get; set; }
            public string ItemName { get; set; }
            public string ItemClsCode { get; set; }
            public string PkgUnitCode { get; set; }
            public string QtyUnitCode { get; set; }
            public string TaxTypeCode { get; set; }
            public double Quantity { get; set; }
            public double UnitPrice { get; set; }
            public double SupplyAmount { get; set; }
            public double DiscountRate { get; set; }
            public double DiscountAmount { get; set; }
            public double TaxableAmount { get; set; }
            public double TaxAmount { get; set; }
            public double TotalAmount { get; set; }
            public double CurrentStock { get; set; }
            public double NewStock { get; set; }
        }

        public InvoiceResult GenerateInvoice(InvoiceRequest req)
        {
            var sw = Stopwatch.StartNew();
            var res = new InvoiceResult();

            try
            {
                if (req.Items == null || req.Items.Count == 0)
                {
                    throw new ArgumentException("At least one sale item is required.");
                }

                DateTime now = DateTime.Now;
                string rcptDt = now.ToString("yyyyMMddHHmmss");
                string salesDt = now.ToString("yyyyMMdd");
                string isoDt = now.ToString("yyyy-MM-ddTHH:mm:ss+03:00");
                string displayDt = now.ToString("dd-MM-yyyy");
                string displayTime = now.ToString("HH:mm:ss");

                string buyerPin = !string.IsNullOrEmpty(req.BuyerPin) ? req.BuyerPin.Trim() : "NA";
                string buyerName = !string.IsNullOrEmpty(req.BuyerName) ? req.BuyerName.Trim() : "Walk-In Customer";
                string paymentCode = !string.IsNullOrEmpty(req.PaymentCode) ? req.PaymentCode.Trim() : "01";
                string remark = !string.IsNullOrEmpty(req.Remark) ? req.Remark.Trim() : ("Oraforge:" + Guid.NewGuid().ToString("N"));

                using (var conn = new SQLiteConnection(_connString))
                {
                    conn.Open();
                    using (var tx = conn.BeginTransaction())
                    {
                        // 1. Ensure Customer in TAXPAYER_BHF_CUST if specific PIN is given
                        if (buyerPin != "NA" && !string.IsNullOrEmpty(buyerPin))
                        {
                            EnsureCustomer(conn, tx, buyerPin, buyerName, req.BuyerPhone, req.BuyerEmail, req.BuyerAddress, rcptDt);
                        }

                        // 2. Next sequence numbers
                        long invcNo = GetNextSequence(conn, tx, "SELECT coalesce(max(INVC_NO), 0) + 1 FROM TRNS_SALE");
                        long curRcptNo = GetNextSequence(conn, tx, "SELECT coalesce(max(CUR_RCPT_NO), 0) + 1 FROM TRNS_SALE_RECEIPT");
                        long totRcptNo = GetNextSequence(conn, tx, "SELECT coalesce(max(TOT_RCPT_NO), 0) + 1 FROM TRNS_SALE_RECEIPT");
                        long sarNo = GetNextSequence(conn, tx, "SELECT coalesce(max(SAR_NO), 0) + 1 FROM STOCK_IO");

                        // 3. Historical cumulative totals for InternalData
                        long totSalesBefore = GetScalarLong(conn, tx, "SELECT coalesce(sum(TOT_AMT), 0) FROM TRNS_SALE WHERE SALES_STTS_CD='02' AND RCPT_TY_CD='S'");
                        long totRefundBefore = GetScalarLong(conn, tx, "SELECT coalesce(sum(TOT_AMT), 0) FROM TRNS_SALE WHERE SALES_STTS_CD='02' AND RCPT_TY_CD='R'");
                        long dayCount = GetScalarLong(conn, tx, "SELECT coalesce(max(RPT_NO), 1) FROM TRNS_SALE_RECEIPT");
                        if (dayCount < 1) dayCount = 1;

                        // 4. Resolve and Validate each item line
                        var resolvedItems = new List<ResolvedItem>();
                        double totalSaleAmt = 0;
                        double totalDiscAmt = 0;
                        double taxblAmtA = 0;
                        double taxblAmtB = 0;
                        double taxblAmtC = 0;
                        double taxblAmtD = 0;
                        double taxblAmtE = 0;
                        double taxAmtA = 0;
                        double taxAmtB = 0;
                        double taxAmtC = 0;
                        double taxAmtD = 0;
                        double taxAmtE = 0;
                        int seq = 1;

                        foreach (var itemInput in req.Items)
                        {
                            var resolved = ResolveItem(conn, tx, itemInput, seq++, rcptDt);
                            resolvedItems.Add(resolved);
                            totalSaleAmt += resolved.TotalAmount;
                            totalDiscAmt += resolved.DiscountAmount;

                            switch (resolved.TaxTypeCode)
                            {
                                case "A":
                                    taxblAmtA += resolved.TotalAmount;
                                    taxAmtA += resolved.TaxAmount;
                                    break;
                                case "B":
                                    taxblAmtB += resolved.TotalAmount;
                                    taxAmtB += resolved.TaxAmount;
                                    break;
                                case "C":
                                    taxblAmtC += resolved.TotalAmount;
                                    taxAmtC += resolved.TaxAmount;
                                    break;
                                case "E":
                                    taxblAmtE += resolved.TotalAmount;
                                    taxAmtE += resolved.TaxAmount;
                                    break;
                                case "D":
                                default:
                                    taxblAmtD += resolved.TotalAmount;
                                    taxAmtD += resolved.TaxAmount;
                                    break;
                            }
                        }

                        totalSaleAmt = Math.Round(totalSaleAmt, 2);
                        totalDiscAmt = Math.Round(totalDiscAmt, 2);
                        taxblAmtA = Math.Round(taxblAmtA, 2);
                        taxblAmtB = Math.Round(taxblAmtB, 2);
                        taxblAmtC = Math.Round(taxblAmtC, 2);
                        taxblAmtD = Math.Round(taxblAmtD, 2);
                        taxblAmtE = Math.Round(taxblAmtE, 2);
                        taxAmtA = Math.Round(taxAmtA, 2);
                        taxAmtB = Math.Round(taxAmtB, 2);
                        taxAmtC = Math.Round(taxAmtC, 2);
                        taxAmtD = Math.Round(taxAmtD, 2);
                        taxAmtE = Math.Round(taxAmtE, 2);
                        double totTaxAmt = Math.Round(taxAmtA + taxAmtB + taxAmtC + taxAmtD + taxAmtE, 2);
                        double totTaxblAmt = totalSaleAmt;

                        // 5. Compute Receipt Signature via official eTIMS algorithm
                        var receiptMaster = new TrnsSaleReceiptMaster();
                        var sigParam = new ReceiptSignature();
                        sigParam.RcptDt = rcptDt;
                        sigParam.Tin = _tin;
                        sigParam.CustTin = (buyerPin != "NA") ? buyerPin : "";
                        sigParam.GblMrcSysCod = _mrcCode;
                        sigParam.GblSdcSysNum = _scuId;
                        sigParam.TranRcptTyCD = "NS";
                        sigParam.CurReceiptID = curRcptNo;
                        sigParam.TotReceiptID = totRcptNo;
                        sigParam.InvID = 0;
                        sigParam.DblSpcpcA = taxblAmtA;
                        sigParam.DblVatA = taxAmtA;
                        sigParam.DblSpcpcB = taxblAmtB;
                        sigParam.DblVatB = taxAmtB;
                        sigParam.DblSpcpcC = taxblAmtC;
                        sigParam.DblVatC = taxAmtC;

                        string sigStr = receiptMaster.GetReceiptSignature(sigParam);
                        string rawSig = (string)Base32.Receipt_signature(sigStr, _signKey);
                        string formattedSig = FormatChunked(rawSig, 4);

                        // 6. Compute Internal Data
                        string hex1 = (string)Base32.longToHex(totSalesBefore, 5);
                        string hex2 = (string)Base32.longToHex(curRcptNo, 4);
                        string hex3 = (string)Base32.longToHex(totRefundBefore, 5);
                        string hex4 = (string)Base32.longToHex(dayCount, 2);
                        string intrlHex = hex1 + hex2 + hex3 + hex4;

                        string rawIntrl = Base32.Internal_data(intrlHex, _signKey);
                        string formattedIntrl = FormatChunked(rawIntrl, 4);

                        // 7. Generate Official KRA QR Code URL and PNG
                        string cuInvoiceNo = _scuId + "/" + curRcptNo;
                        string qrPayload = string.Format("https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data={0}{1}{2}", _tin, _branchId, rawSig);

                        string qrPath = Path.Combine(_outputDir, string.Format("inv_{0}_qr.png", invcNo));
                        string qrSha256;
                        string qrBase64 = GenerateQrCodePng(qrPayload, qrPath, out qrSha256);

                        // 8. Format Electronic Journal (JRNL)
                        string jrnl = BuildJournalText(displayDt, displayTime, buyerPin, buyerName, paymentCode, remark, resolvedItems, totalSaleAmt, totalDiscAmt, taxblAmtA, taxblAmtB, taxAmtB, taxblAmtD, totTaxAmt, cuInvoiceNo, formattedIntrl, formattedSig, rawSig);

                        // 9. INSERT TRNS_SALE
                        using (var cmd = conn.CreateCommand())
                        {
                            cmd.Transaction = tx;
                            cmd.CommandText = @"
INSERT INTO TRNS_SALE (
    TIN, BHF_ID, INVC_NO, PRCHR_ACPTC_YN, ORG_INVC_NO, TAXPR_NM,
    CUST_TIN, CUST_BHF_ID, CUST_NM, SALES_TY_CD, RCPT_TY_CD, PMT_TY_CD,
    SALES_STTS_CD, CFM_DT, SALES_DT, STOCK_RLS_DT, CNCL_REQ_DT, CNCL_DT, RFD_DT,
    TOT_ITEM_CNT, TAXBL_AMT_A, TAXBL_AMT_B, TAXBL_AMT_C, TAXBL_AMT_D, TAXBL_AMT_E,
    TAX_RT_A, TAX_RT_B, TAX_RT_C, TAX_RT_D, TAX_RT_E,
    TAX_AMT_A, TAX_AMT_B, TAX_AMT_C, TAX_AMT_D, TAX_AMT_E,
    TOT_TAXBL_AMT, TOT_TAX_AMT, TOT_AMT, REMARK,
    REGR_ID, REGR_NM, REG_DT, MODR_ID, MODR_NM, MOD_DT,
    REFUND_REASON, REFUND_REASON_TEXT
) VALUES (
    @tin, @bhfId, @invcNo, 'N', 0, @taxprNm,
    @custTin, '00', @custNm, 'N', 'S', @pmtTyCd,
    '02', @cfmDt, @salesDt, '', '', '', '',
    @totItemCnt, @taxblAmtA, @taxblAmtB, @taxblAmtC, @taxblAmtD, @taxblAmtE,
    0, @taxRtB, 0, 0, 0,
    @taxAmtA, @taxAmtB, @taxAmtC, @taxAmtD, @taxAmtE,
    @totTaxblAmt, @totTaxAmt, @totAmt, @remark,
    @userId, @userNm, @regDt, @userId, @userNm, @regDt,
    '', ''
);";
                            cmd.Parameters.AddWithValue("@tin", _tin);
                            cmd.Parameters.AddWithValue("@bhfId", _branchId);
                            cmd.Parameters.AddWithValue("@invcNo", invcNo);
                            cmd.Parameters.AddWithValue("@taxprNm", _taxpayerName);
                            cmd.Parameters.AddWithValue("@custTin", buyerPin);
                            cmd.Parameters.AddWithValue("@custNm", buyerName);
                            cmd.Parameters.AddWithValue("@pmtTyCd", paymentCode);
                            cmd.Parameters.AddWithValue("@cfmDt", rcptDt);
                            cmd.Parameters.AddWithValue("@salesDt", salesDt);
                            cmd.Parameters.AddWithValue("@totItemCnt", (double)resolvedItems.Count);
                            cmd.Parameters.AddWithValue("@taxblAmtA", taxblAmtA);
                            cmd.Parameters.AddWithValue("@taxblAmtB", taxblAmtB);
                            cmd.Parameters.AddWithValue("@taxblAmtC", taxblAmtC);
                            cmd.Parameters.AddWithValue("@taxblAmtD", taxblAmtD);
                            cmd.Parameters.AddWithValue("@taxblAmtE", taxblAmtE);
                            cmd.Parameters.AddWithValue("@taxRtB", taxblAmtB > 0 ? 16 : 0);
                            cmd.Parameters.AddWithValue("@taxAmtA", taxAmtA);
                            cmd.Parameters.AddWithValue("@taxAmtB", taxAmtB);
                            cmd.Parameters.AddWithValue("@taxAmtC", taxAmtC);
                            cmd.Parameters.AddWithValue("@taxAmtD", taxAmtD);
                            cmd.Parameters.AddWithValue("@taxAmtE", taxAmtE);
                            cmd.Parameters.AddWithValue("@totTaxblAmt", totTaxblAmt);
                            cmd.Parameters.AddWithValue("@totTaxAmt", totTaxAmt);
                            cmd.Parameters.AddWithValue("@totAmt", totalSaleAmt);
                            cmd.Parameters.AddWithValue("@remark", remark);
                            cmd.Parameters.AddWithValue("@userId", _userId);
                            cmd.Parameters.AddWithValue("@userNm", _userNm);
                            cmd.Parameters.AddWithValue("@regDt", rcptDt);
                            cmd.ExecuteNonQuery();
                        }

                        // 10. INSERT TRNS_SALE_ITEM for each item
                        foreach (var item in resolvedItems)
                        {
                            using (var cmd = conn.CreateCommand())
                            {
                                cmd.Transaction = tx;
                                cmd.CommandText = @"
INSERT INTO TRNS_SALE_ITEM (
    TIN, BHF_ID, INVC_NO, ITEM_SEQ, ITEM_CD, ISRCC_CD, ITEM_CLS_CD, ITEM_NM,
    BCD, PKG_UNIT_CD, PKG, QTY_UNIT_CD, QTY, PRC, SPLY_AMT,
    DC_RT, DC_AMT, ISRCC_NM, ISRC_RT, ISRC_AMT, TAX_TY_CD,
    TAXBL_AMT, TAX_AMT, TOT_AMT,
    REGR_ID, REGR_NM, REG_DT, MODR_ID, MODR_NM, MOD_DT
) VALUES (
    @tin, @bhfId, @invcNo, @itemSeq, @itemCd, '', @itemClsCd, @itemNm,
    '', @pkgUnitCd, 0, @qtyUnitCd, @qty, @prc, @splyAmt,
    @dcRt, @dcAmt, '', 0, 0, @taxTyCd,
    @taxblAmt, @taxAmt, @totAmt,
    @userId, @userNm, @regDt, @userId, @userNm, @regDt
);";
                                cmd.Parameters.AddWithValue("@tin", _tin);
                                cmd.Parameters.AddWithValue("@bhfId", _branchId);
                                cmd.Parameters.AddWithValue("@invcNo", invcNo);
                                cmd.Parameters.AddWithValue("@itemSeq", item.Seq);
                                cmd.Parameters.AddWithValue("@itemCd", item.ItemCode);
                                cmd.Parameters.AddWithValue("@itemClsCd", item.ItemClsCode);
                                cmd.Parameters.AddWithValue("@itemNm", item.ItemName);
                                cmd.Parameters.AddWithValue("@pkgUnitCd", item.PkgUnitCode);
                                cmd.Parameters.AddWithValue("@qtyUnitCd", item.QtyUnitCode);
                                cmd.Parameters.AddWithValue("@qty", item.Quantity);
                                cmd.Parameters.AddWithValue("@prc", item.UnitPrice);
                                cmd.Parameters.AddWithValue("@splyAmt", item.SupplyAmount);
                                cmd.Parameters.AddWithValue("@dcRt", item.DiscountRate);
                                cmd.Parameters.AddWithValue("@dcAmt", item.DiscountAmount);
                                cmd.Parameters.AddWithValue("@taxTyCd", item.TaxTypeCode);
                                cmd.Parameters.AddWithValue("@taxblAmt", item.TaxableAmount);
                                cmd.Parameters.AddWithValue("@taxAmt", item.TaxAmount);
                                cmd.Parameters.AddWithValue("@totAmt", item.TotalAmount);
                                cmd.Parameters.AddWithValue("@userId", _userId);
                                cmd.Parameters.AddWithValue("@userNm", _userNm);
                                cmd.Parameters.AddWithValue("@regDt", rcptDt);
                                cmd.ExecuteNonQuery();
                            }
                        }

                        // 11. INSERT TRNS_SALE_RECEIPT
                        using (var cmd = conn.CreateCommand())
                        {
                            cmd.Transaction = tx;
                            cmd.CommandText = @"
INSERT INTO TRNS_SALE_RECEIPT (
    TIN, BHF_ID, INVC_NO, PRCHR_ACPTC_YN, ORG_INVC_NO, CUR_RCPT_NO, TOT_RCPT_NO,
    TAXPR_NM, RCPT_PBCT_DT, INTRL_DATA, RCPT_SIGN, JRNL, TRDE_NM, ADRS,
    TOP_MSG, BTM_MSG, RPT_NO, RPT_DT,
    REGR_ID, REGR_NM, REG_DT, MODR_ID, MODR_NM, MOD_DT, PRINT_COUNT
) VALUES (
    @tin, @bhfId, @invcNo, 'N', 0, @curRcptNo, @totRcptNo,
    @taxprNm, @rcptPbctDt, @intrlData, @rcptSign, @jrnl, '', '',
    '', '', @rptNo, '',
    @userId, @userNm, @regDt, @userId, @userNm, @regDt, 0
);";
                            cmd.Parameters.AddWithValue("@tin", _tin);
                            cmd.Parameters.AddWithValue("@bhfId", _branchId);
                            cmd.Parameters.AddWithValue("@invcNo", invcNo);
                            cmd.Parameters.AddWithValue("@curRcptNo", curRcptNo);
                            cmd.Parameters.AddWithValue("@totRcptNo", totRcptNo);
                            cmd.Parameters.AddWithValue("@taxprNm", _taxpayerName);
                            cmd.Parameters.AddWithValue("@rcptPbctDt", rcptDt);
                            cmd.Parameters.AddWithValue("@intrlData", rawIntrl);
                            cmd.Parameters.AddWithValue("@rcptSign", rawSig);
                            cmd.Parameters.AddWithValue("@jrnl", jrnl);
                            cmd.Parameters.AddWithValue("@rptNo", dayCount);
                            cmd.Parameters.AddWithValue("@userId", _userId);
                            cmd.Parameters.AddWithValue("@userNm", _userNm);
                            cmd.Parameters.AddWithValue("@regDt", rcptDt);
                            cmd.ExecuteNonQuery();
                        }

                        // 12. INSERT STOCK_IO
                        using (var cmd = conn.CreateCommand())
                        {
                            cmd.Transaction = tx;
                            cmd.CommandText = @"
INSERT INTO STOCK_IO (
    TIN, BHF_ID, SAR_NO, ORG_SAR_NO, REG_TY_CD, TAXPR_NM, CUST_TIN, CUST_BHF_ID,
    CUST_NM, SAR_TY_CD, OCRN_DT, TOT_ITEM_CNT, TOT_TAXBL_AMT, TOT_TAX_AMT, TOT_AMT,
    REMARK, REGR_ID, REGR_NM, REG_DT, MODR_ID, MODR_NM, MOD_DT
) VALUES (
    @tin, @bhfId, @sarNo, 0, 'A', @taxprNm, @custTin, '00',
    @custNm, '11', @ocrnDt, @totItemCnt, @totTaxblAmt, @totTaxAmt, @totAmt,
    '', @userId, @userNm, @regDt, @userId, @userNm, @regDt
);";
                            cmd.Parameters.AddWithValue("@tin", _tin);
                            cmd.Parameters.AddWithValue("@bhfId", _branchId);
                            cmd.Parameters.AddWithValue("@sarNo", sarNo);
                            cmd.Parameters.AddWithValue("@taxprNm", _taxpayerName);
                            cmd.Parameters.AddWithValue("@custTin", buyerPin);
                            cmd.Parameters.AddWithValue("@custNm", buyerName);
                            cmd.Parameters.AddWithValue("@ocrnDt", salesDt);
                            cmd.Parameters.AddWithValue("@totItemCnt", resolvedItems.Count);
                            cmd.Parameters.AddWithValue("@totTaxblAmt", totalSaleAmt);
                            cmd.Parameters.AddWithValue("@totTaxAmt", totTaxAmt);
                            cmd.Parameters.AddWithValue("@totAmt", totalSaleAmt);
                            cmd.Parameters.AddWithValue("@userId", _userId);
                            cmd.Parameters.AddWithValue("@userNm", _userNm);
                            cmd.Parameters.AddWithValue("@regDt", rcptDt);
                            cmd.ExecuteNonQuery();
                        }

                        // 13. INSERT STOCK_IO_ITEM and UPDATE STOCK_MASTER for each item
                        foreach (var item in resolvedItems)
                        {
                            using (var cmd = conn.CreateCommand())
                            {
                                cmd.Transaction = tx;
                                cmd.CommandText = @"
INSERT INTO STOCK_IO_ITEM (
    TIN, BHF_ID, SAR_NO, ITEM_SEQ, ITEM_CD, ITEM_CLS_CD, ITEM_NM, BCD,
    PKG_UNIT_CD, PKG, QTY_UNIT_CD, QTY, ITEM_EXPR_DT, PRC, SPLY_AMT, TOT_DC_AMT,
    TAXBL_AMT, TAX_TY_CD, TAX_AMT, TOT_AMT,
    REGR_ID, REGR_NM, REG_DT, MODR_ID, MODR_NM, MOD_DT
) VALUES (
    @tin, @bhfId, @sarNo, @itemSeq, @itemCd, @itemClsCd, @itemNm, '',
    @pkgUnitCd, 0, @qtyUnitCd, @qty, '', @prc, @splyAmt, @totDcAmt,
    @taxblAmt, @taxTyCd, @taxAmt, @totAmt,
    @userId, @userNm, @regDt, @userId, @userNm, @regDt
);";
                                cmd.Parameters.AddWithValue("@tin", _tin);
                                cmd.Parameters.AddWithValue("@bhfId", _branchId);
                                cmd.Parameters.AddWithValue("@sarNo", sarNo);
                                cmd.Parameters.AddWithValue("@itemSeq", item.Seq);
                                cmd.Parameters.AddWithValue("@itemCd", item.ItemCode);
                                cmd.Parameters.AddWithValue("@itemClsCd", item.ItemClsCode);
                                cmd.Parameters.AddWithValue("@itemNm", item.ItemName);
                                cmd.Parameters.AddWithValue("@pkgUnitCd", item.PkgUnitCode);
                                cmd.Parameters.AddWithValue("@qtyUnitCd", item.QtyUnitCode);
                                cmd.Parameters.AddWithValue("@qty", item.Quantity);
                                cmd.Parameters.AddWithValue("@prc", item.UnitPrice);
                                cmd.Parameters.AddWithValue("@splyAmt", item.SupplyAmount);
                                cmd.Parameters.AddWithValue("@totDcAmt", item.DiscountAmount);
                                cmd.Parameters.AddWithValue("@taxblAmt", item.TaxableAmount);
                                cmd.Parameters.AddWithValue("@taxTyCd", item.TaxTypeCode);
                                cmd.Parameters.AddWithValue("@taxAmt", item.TaxAmount);
                                cmd.Parameters.AddWithValue("@totAmt", item.TotalAmount);
                                cmd.Parameters.AddWithValue("@userId", _userId);
                                cmd.Parameters.AddWithValue("@userNm", _userNm);
                                cmd.Parameters.AddWithValue("@regDt", rcptDt);
                                cmd.ExecuteNonQuery();
                            }

                            // Update stock master
                            using (var cmd = conn.CreateCommand())
                            {
                                cmd.Transaction = tx;
                                cmd.CommandText = "UPDATE STOCK_MASTER SET RSD_QTY=@newStock, MOD_DT=@modDt, MODR_ID=@userId, MODR_NM=@userNm WHERE TIN=@tin AND BHF_ID=@branch AND ITEM_CD=@itemCd";
                                cmd.Parameters.AddWithValue("@newStock", item.NewStock);
                                cmd.Parameters.AddWithValue("@modDt", rcptDt);
                                cmd.Parameters.AddWithValue("@userId", _userId);
                                cmd.Parameters.AddWithValue("@userNm", _userNm);
                                cmd.Parameters.AddWithValue("@tin", _tin);
                                cmd.Parameters.AddWithValue("@branch", _branchId);
                                cmd.Parameters.AddWithValue("@itemCd", item.ItemCode);
                                cmd.ExecuteNonQuery();
                            }
                        }

                        tx.Commit();

                        // 14. Write Encrypted Outbox Queue Files
                        WriteOutboxJson(now, invcNo, curRcptNo, totRcptNo, sarNo, buyerPin, buyerName, paymentCode, remark, resolvedItems, totalSaleAmt, taxblAmtA, taxblAmtB, taxAmtB, taxblAmtD, totTaxAmt, rcptDt, salesDt, rawSig, rawIntrl, jrnl, dayCount);

                        sw.Stop();
                        res.Success = true;
                        res.LocalInvoiceId = invcNo;
                        res.InvoiceNumber = invcNo.ToString();
                        res.CuInvoiceNumber = cuInvoiceNo;
                        res.ScuId = _scuId;
                        res.ReceiptSignature = rawSig;
                        res.ReceiptSignatureFormatted = formattedSig;
                        res.InternalData = formattedIntrl;
                        res.InvoiceDate = isoDt;
                        res.QrCode = new QrCodeInfo
                        {
                            Image = qrPath,
                            Payload = qrPayload,
                            Sha256 = qrSha256,
                            Source = "programmatic"
                        };
                        res.PdfSha256 = qrSha256;
                        res.TotalAmount = totalSaleAmt;
                        res.ExecutionMs = sw.ElapsedMilliseconds;
                    }
                }
            }
            catch (Exception ex)
            {
                sw.Stop();
                res.Success = false;
                res.Error = ex.ToString();
                res.ExecutionMs = sw.ElapsedMilliseconds;
            }

            return res;
        }

        private ResolvedItem ResolveItem(SQLiteConnection conn, SQLiteTransaction tx, InvoiceItemInput input, int seq, string rcptDt)
        {
            string itemCd = input.ItemCode;
            string itemNm = input.Name;
            double qty = input.Quantity > 0 ? input.Quantity : 1.0;
            double prc = input.UnitPrice >= 0 ? input.UnitPrice : 0.0;
            double splyAmt = input.SupplyAmount > 0 ? input.SupplyAmount : Math.Round(qty * prc, 2);
            double dcAmt = Math.Max(0.0, input.DiscountAmount);
            double dcRt = Math.Max(0.0, input.DiscountRate);

            if (dcAmt > 0 && dcRt == 0 && splyAmt > 0)
            {
                dcRt = Math.Round((dcAmt / splyAmt) * 100.0, 2);
            }
            else if (dcRt > 0 && dcAmt == 0 && splyAmt > 0)
            {
                dcAmt = Math.Round((splyAmt * dcRt) / 100.0, 2);
            }

            double total = input.LineTotal > 0 ? input.LineTotal : Math.Round(Math.Max(0.0, splyAmt - dcAmt), 2);
            if (total > splyAmt) total = splyAmt;

            string reqTax = !string.IsNullOrEmpty(input.TaxCode) ? input.TaxCode.Trim().ToUpper() : "";
            string itemClsCd = "60102300";
            string pkgUnitCd = "OU";
            string qtyUnitCd = "NO";
            string taxTyCd = !string.IsNullOrEmpty(reqTax) ? reqTax : "D";
            double currentStock = 100.0;

            bool found = false;

            // Try find by item code
            if (!string.IsNullOrEmpty(itemCd))
            {
                using (var cmd = conn.CreateCommand())
                {
                    cmd.Transaction = tx;
                    cmd.CommandText = @"
SELECT i.ITEM_CD, i.ITEM_NM, i.ITEM_CLS_CD, i.PKG_UNIT_CD, i.QTY_UNIT_CD, i.TAX_TY_CD, coalesce(s.RSD_QTY, 0) as RSD_QTY
FROM TAXPAYER_ITEM i
LEFT JOIN STOCK_MASTER s ON s.TIN=i.TIN AND s.ITEM_CD=i.ITEM_CD AND s.BHF_ID=@branch
WHERE i.TIN=@tin AND i.ITEM_CD=@itemCd LIMIT 1;";
                    cmd.Parameters.AddWithValue("@tin", _tin);
                    cmd.Parameters.AddWithValue("@branch", _branchId);
                    cmd.Parameters.AddWithValue("@itemCd", itemCd);
                    using (var r = cmd.ExecuteReader())
                    {
                        if (r.Read())
                        {
                            itemCd = r["ITEM_CD"].ToString();
                            itemNm = r["ITEM_NM"].ToString();
                            itemClsCd = r["ITEM_CLS_CD"].ToString();
                            pkgUnitCd = r["PKG_UNIT_CD"].ToString();
                            qtyUnitCd = r["QTY_UNIT_CD"].ToString();
                            string dbTax = r["TAX_TY_CD"].ToString();
                            taxTyCd = !string.IsNullOrEmpty(reqTax) ? reqTax : dbTax;
                            currentStock = Convert.ToDouble(r["RSD_QTY"]);
                            found = true;
                        }
                    }
                }
            }

            // If not found by code, try by name
            if (!found && !string.IsNullOrEmpty(itemNm))
            {
                using (var cmd = conn.CreateCommand())
                {
                    cmd.Transaction = tx;
                    cmd.CommandText = @"
SELECT i.ITEM_CD, i.ITEM_NM, i.ITEM_CLS_CD, i.PKG_UNIT_CD, i.QTY_UNIT_CD, i.TAX_TY_CD, coalesce(s.RSD_QTY, 0) as RSD_QTY
FROM TAXPAYER_ITEM i
LEFT JOIN STOCK_MASTER s ON s.TIN=i.TIN AND s.ITEM_CD=i.ITEM_CD AND s.BHF_ID=@branch
WHERE i.TIN=@tin AND lower(trim(i.ITEM_NM))=lower(trim(@itemNm)) LIMIT 1;";
                    cmd.Parameters.AddWithValue("@tin", _tin);
                    cmd.Parameters.AddWithValue("@branch", _branchId);
                    cmd.Parameters.AddWithValue("@itemNm", itemNm);
                    using (var r = cmd.ExecuteReader())
                    {
                        if (r.Read())
                        {
                            itemCd = r["ITEM_CD"].ToString();
                            itemNm = r["ITEM_NM"].ToString();
                            itemClsCd = r["ITEM_CLS_CD"].ToString();
                            pkgUnitCd = r["PKG_UNIT_CD"].ToString();
                            qtyUnitCd = r["QTY_UNIT_CD"].ToString();
                            string dbTax = r["TAX_TY_CD"].ToString();
                            taxTyCd = !string.IsNullOrEmpty(reqTax) ? reqTax : dbTax;
                            currentStock = Convert.ToDouble(r["RSD_QTY"]);
                            found = true;
                        }
                    }
                }
            }

            // If found, update TAXPAYER_ITEM if taxTyCd changed (e.g. merchant registered as D but selling as B)
            if (found && !string.IsNullOrEmpty(reqTax))
            {
                using (var up = conn.CreateCommand())
                {
                    up.Transaction = tx;
                    up.CommandText = "UPDATE TAXPAYER_ITEM SET TAX_TY_CD=@taxTyCd WHERE TIN=@tin AND ITEM_CD=@itemCd;";
                    up.Parameters.AddWithValue("@taxTyCd", taxTyCd);
                    up.Parameters.AddWithValue("@tin", _tin);
                    up.Parameters.AddWithValue("@itemCd", itemCd);
                    up.ExecuteNonQuery();
                }
            }

            // If still not found, auto-register this item in TAXPAYER_ITEM and STOCK_MASTER
            if (!found)
            {
                if (string.IsNullOrEmpty(itemCd))
                {
                    long itemSeq = GetNextSequence(conn, tx, "SELECT coalesce(count(*), 0) + 1 FROM TAXPAYER_ITEM WHERE TIN='" + _tin + "'");
                    itemCd = string.Format("KE-2OUXNOX-{0:0000000}", itemSeq);
                    while (true)
                    {
                        using (var chk = conn.CreateCommand())
                        {
                            chk.Transaction = tx;
                            chk.CommandText = "SELECT COUNT(*) FROM TAXPAYER_ITEM WHERE TIN=@tin AND ITEM_CD=@cd";
                            chk.Parameters.AddWithValue("@tin", _tin);
                            chk.Parameters.AddWithValue("@cd", itemCd);
                            long c = Convert.ToInt64(chk.ExecuteScalar());
                            if (c == 0) break;
                            itemSeq++;
                            itemCd = string.Format("KE-2OUXNOX-{0:0000000}", itemSeq);
                        }
                    }
                }
                if (string.IsNullOrEmpty(itemNm))
                {
                    itemNm = "General Merchandise";
                }

                currentStock = 1000.0; // Default opening stock for programmatic items

                // Insert into TAXPAYER_ITEM
                using (var cmd = conn.CreateCommand())
                {
                    cmd.Transaction = tx;
                    cmd.CommandText = @"
INSERT OR IGNORE INTO TAXPAYER_ITEM (
    TIN, ITEM_CD, ITEM_CLS_CD, ITEM_TY_CD, ITEM_NM, ITEM_STD_NM,
    ORGN_NAT_CD, PKG_UNIT_CD, QTY_UNIT_CD, TAX_TY_CD, BCD, REG_BHF_ID,
    USE_YN, RRA_MOD_YN, ADD_INFO, SFTY_QTY, ISRC_APLCB_YN,
    DFT_PRC, GRP_PRC_L1, GRP_PRC_L2, GRP_PRC_L3, GRP_PRC_L4, GRP_PRC_L5,
    INITL_WH_UNTPC, INITL_QTY, RM, USE_BARCODE, USE_ADI_YN, BATCH_NUM, EXPIRATION_YN,
    REGR_ID, REGR_NM, REG_DT, MODR_ID, MODR_NM, MOD_DT
) VALUES (
    @tin, @itemCd, @itemClsCd, '2', @itemNm, @itemNm,
    'KE', @pkgUnitCd, @qtyUnitCd, @taxTyCd, '', @branch,
    'Y', 'N', '', 0, 'N',
    @prc, 0, 0, 0, 0, 0,
    @prc, @rsdQty, 'Auto-registered item', 'N', 'N', '', 'N',
    @userId, @userNm, @regDt, @userId, @userNm, @regDt
);";
                    cmd.Parameters.AddWithValue("@tin", _tin);
                    cmd.Parameters.AddWithValue("@itemCd", itemCd);
                    cmd.Parameters.AddWithValue("@itemClsCd", itemClsCd);
                    cmd.Parameters.AddWithValue("@itemNm", itemNm);
                    cmd.Parameters.AddWithValue("@pkgUnitCd", pkgUnitCd);
                    cmd.Parameters.AddWithValue("@qtyUnitCd", qtyUnitCd);
                    cmd.Parameters.AddWithValue("@taxTyCd", taxTyCd);
                    cmd.Parameters.AddWithValue("@branch", _branchId);
                    cmd.Parameters.AddWithValue("@prc", prc);
                    cmd.Parameters.AddWithValue("@rsdQty", currentStock);
                    cmd.Parameters.AddWithValue("@userId", _userId);
                    cmd.Parameters.AddWithValue("@userNm", _userNm);
                    cmd.Parameters.AddWithValue("@regDt", rcptDt);
                    cmd.ExecuteNonQuery();
                }

                // Insert into STOCK_MASTER
                using (var cmd = conn.CreateCommand())
                {
                    cmd.Transaction = tx;
                    cmd.CommandText = @"
INSERT OR IGNORE INTO STOCK_MASTER (
    TIN, BHF_ID, ITEM_CD, RSD_QTY,
    REGR_ID, REGR_NM, REG_DT, MODR_ID, MODR_NM, MOD_DT
) VALUES (
    @tin, @branch, @itemCd, @rsdQty,
    @userId, @userNm, @regDt, @userId, @userNm, @regDt
);";
                    cmd.Parameters.AddWithValue("@tin", _tin);
                    cmd.Parameters.AddWithValue("@branch", _branchId);
                    cmd.Parameters.AddWithValue("@itemCd", itemCd);
                    cmd.Parameters.AddWithValue("@rsdQty", currentStock);
                    cmd.Parameters.AddWithValue("@userId", _userId);
                    cmd.Parameters.AddWithValue("@userNm", _userNm);
                    cmd.Parameters.AddWithValue("@regDt", rcptDt);
                    cmd.ExecuteNonQuery();
                }
            }

            double newStock = Math.Max(0.0, currentStock - qty);

            // Calculate tax
            double taxAmt = 0.0;
            double taxblAmt = total;
            if (taxTyCd == "B")
            {
                taxAmt = Math.Round((total * 16.0) / 116.0, 2);
            }

            var item = new ResolvedItem();
            item.Seq = seq;
            item.ItemCode = itemCd;
            item.ItemName = itemNm;
            item.ItemClsCode = itemClsCd;
            item.PkgUnitCode = pkgUnitCd;
            item.QtyUnitCode = qtyUnitCd;
            item.TaxTypeCode = taxTyCd;
            item.Quantity = qty;
            item.UnitPrice = prc;
            item.SupplyAmount = splyAmt;
            item.DiscountRate = dcRt;
            item.DiscountAmount = dcAmt;
            item.TaxableAmount = taxblAmt;
            item.TaxAmount = taxAmt;
            item.TotalAmount = total;
            item.CurrentStock = currentStock;
            item.NewStock = newStock;
            return item;
        }

        private void EnsureCustomer(SQLiteConnection conn, SQLiteTransaction tx, string buyerPin, string buyerName, string phone, string email, string address, string regDt)
        {
            try
            {
                using (var cmd = conn.CreateCommand())
                {
                    cmd.Transaction = tx;
                    cmd.CommandText = "SELECT count(*) FROM TAXPAYER_BHF_CUST WHERE TIN=@tin AND BHF_ID=@branch AND CUST_TIN=@custTin;";
                    cmd.Parameters.AddWithValue("@tin", _tin);
                    cmd.Parameters.AddWithValue("@branch", _branchId);
                    cmd.Parameters.AddWithValue("@custTin", buyerPin);
                    long exists = Convert.ToInt64(cmd.ExecuteScalar());
                    if (exists == 0)
                    {
                        using (var ins = conn.CreateCommand())
                        {
                            ins.Transaction = tx;
                            ins.CommandText = @"
INSERT OR IGNORE INTO TAXPAYER_BHF_CUST (
    TIN, BHF_ID, CUST_NO, CUST_TIN, CUST_NM, TEL_NO, CONTACT1, ADRS, USE_YN,
    REGR_ID, REGR_NM, REG_DT, MODR_ID, MODR_NM, MOD_DT,
    RM, EMAIL, BCNC_TYPE, CUST_GROUP
) VALUES (
    @tin, @bhfId, @custTin, @custTin, @custNm, @telNo, @telNo, @adrs, 'Y',
    @userId, @userNm, @regDt, @userId, @userNm, @regDt,
    'Oraforge auto-registration', @email, '02', 'DF'
);";
                            ins.Parameters.AddWithValue("@tin", _tin);
                            ins.Parameters.AddWithValue("@bhfId", _branchId);
                            ins.Parameters.AddWithValue("@custTin", buyerPin);
                            ins.Parameters.AddWithValue("@custNm", buyerName ?? "Customer");
                            ins.Parameters.AddWithValue("@telNo", phone ?? "");
                            ins.Parameters.AddWithValue("@adrs", address ?? "");
                            ins.Parameters.AddWithValue("@email", email ?? "");
                            ins.Parameters.AddWithValue("@userId", _userId);
                            ins.Parameters.AddWithValue("@userNm", _userNm);
                            ins.Parameters.AddWithValue("@regDt", regDt);
                            ins.ExecuteNonQuery();
                        }
                    }
                }
            }
            catch
            {
                // Non-fatal if customer table write fails
            }
        }

        private long GetNextSequence(SQLiteConnection conn, SQLiteTransaction tx, string sql)
        {
            using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = sql;
                object val = cmd.ExecuteScalar();
                return Convert.ToInt64(val);
            }
        }

        private long GetScalarLong(SQLiteConnection conn, SQLiteTransaction tx, string sql)
        {
            using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = sql;
                object val = cmd.ExecuteScalar();
                return val != null && val != DBNull.Value ? Convert.ToInt64(val) : 0;
            }
        }

        private string FormatChunked(string s, int chunkSize)
        {
            if (string.IsNullOrEmpty(s)) return s;
            var sb = new StringBuilder();
            for (int i = 0; i < s.Length; i += chunkSize)
            {
                if (sb.Length > 0) sb.Append("-");
                sb.Append(s.Substring(i, Math.Min(chunkSize, s.Length - i)));
            }
            return sb.ToString();
        }

        private string GenerateQrCodePng(string payload, string outputPath, out string sha256Hex)
        {
            var writer = new ZXing.BarcodeWriter();
            writer.Format = ZXing.BarcodeFormat.QR_CODE;
            writer.Options = new ZXing.QrCode.QrCodeEncodingOptions
            {
                Width = 200,
                Height = 200,
                Margin = 1
            };

            using (Bitmap bmp = writer.Write(payload))
            {
                bmp.Save(outputPath, ImageFormat.Png);
                byte[] bytes = File.ReadAllBytes(outputPath);
                using (var sha = SHA256.Create())
                {
                    byte[] hash = sha.ComputeHash(bytes);
                    var sb = new StringBuilder();
                    for (int i = 0; i < hash.Length; i++)
                    {
                        sb.Append(hash[i].ToString("x2"));
                    }
                    sha256Hex = sb.ToString();
                }
                return "data:image/png;base64," + Convert.ToBase64String(bytes);
            }
        }

        private string BuildJournalText(string displayDt, string displayTime, string buyerPin, string buyerName,
                                        string paymentCode, string remark, List<ResolvedItem> items,
                                        double totalAmt, double totalDiscAmt,
                                        double taxblAmtA, double taxblAmtB, double taxAmtB,
                                        double taxblAmtD, double totTaxAmt,
                                        string cuInvoiceNo, string intrlDataChunked,
                                        string rcptSignChunked, string rawSig)
        {
            var sb = new StringBuilder();
            sb.AppendLine();
            sb.AppendLine(_taxpayerName);
            sb.AppendLine(_address);
            sb.AppendLine("KRA PIN: " + _tin);
            sb.AppendLine("CASHIER: " + _userNm);
            sb.AppendLine("-----------------------------------");
            sb.AppendLine("CLIENT KRA PIN: " + buyerPin);
            sb.AppendLine("CLIENT NAME: " + buyerName);
            sb.AppendLine("-----------------------------------");

            foreach (var item in items)
            {
                sb.AppendLine(item.ItemName);
                sb.AppendLine(item.ItemCode);
                if (item.DiscountAmount > 0)
                {
                    sb.AppendLine(string.Format("{0:N2}x{1}            {2:N2}TAX {3}", item.UnitPrice, item.Quantity, item.SupplyAmount, item.TaxTypeCode));
                    sb.AppendLine(string.Format("   DISCOUNT ({0:0.##}%)      -{1:N2}", item.DiscountRate, item.DiscountAmount));
                }
                else
                {
                    sb.AppendLine(string.Format("{0:N2}x{1}            {2:N2}TAX {3}", item.UnitPrice, item.Quantity, item.TotalAmount, item.TaxTypeCode));
                }
            }

            sb.AppendLine("-----------------------------------");
            sb.AppendLine(string.Format("TOTAL                      {0:N2}", totalAmt));
            if (totalDiscAmt > 0)
            {
                sb.AppendLine(string.Format("TOTAL DISCOUNT AMOUNT      {0:N2}", totalDiscAmt));
            }
            sb.AppendLine(string.Format("TOTAL A-EX                 {0:N2}", taxblAmtA));
            sb.AppendLine(string.Format("TOTAL B-16%                {0:N2}", taxblAmtB));
            sb.AppendLine(string.Format("TOTAL TAX-B                {0:N2}", taxAmtB));
            sb.AppendLine(string.Format("TOTAL D                    {0:N2}", taxblAmtD));
            sb.AppendLine("TOTAL TAX-D                    0.00");
            sb.AppendLine(string.Format("TOTAL TAX                  {0:N2}", totTaxAmt));
            sb.AppendLine("-----------------------------------");
            string tenderName = paymentCode == "06" ? "MOBILE MONEY" : "CASH";
            sb.AppendLine(string.Format("{0}                       {1:N2}", tenderName, totalAmt));
            sb.AppendLine("-----------------------------------");
            sb.AppendLine();
            sb.AppendLine("ITEM NUMBER :      " + items.Count);
            sb.AppendLine("-----------------------------------");
            sb.AppendLine("          SCU INFORMATION          ");
            sb.AppendLine(string.Format("Date : {0}   Time : {1}", displayDt, displayTime));
            sb.AppendLine("SCU ID :  " + _scuId + "     ");
            sb.AppendLine("CU Invoice No.: " + cuInvoiceNo);
            sb.AppendLine("          Int. Data :");
            sb.AppendLine(intrlDataChunked);
            sb.AppendLine("        Rcpt Signature :");
            sb.AppendLine(rcptSignChunked);
            sb.AppendLine("-----------------------------------");
            sb.AppendLine("NON-FISCAL INFORMATION:");
            sb.AppendLine(remark);
            sb.AppendLine("-----------------------------------");
            sb.AppendLine("End of Legal Receipt");
            sb.AppendLine("Powered by eTIMS v1.0");
            sb.AppendLine(string.Format("{0}{1}{2}", _tin, _branchId, rawSig));
            sb.AppendLine();
            sb.AppendLine();
            return sb.ToString();
        }

        private void WriteOutboxJson(DateTime now, long invcNo, long curRcptNo, long totRcptNo, long sarNo,
                                    string buyerPin, string buyerName, string paymentCode, string remark,
                                    List<ResolvedItem> items, double totalAmt,
                                    double taxblAmtA, double taxblAmtB, double taxAmtB, double taxblAmtD, double totTaxAmt,
                                    string rcptDt, string salesDt,
                                    string rawSig, string rawIntrl, string jrnl, long dayCount)
        {
            if (!Directory.Exists(_outboxDir))
            {
                Directory.CreateDirectory(_outboxDir);
            }

            string filePrefix = now.ToString("yyyyMMddHHmmssffff_");
            string reqDt = now.ToString("yyyyMMddHHmmss");

            // 1. Sales JSON
            var salesItemsArray = new JArray();
            foreach (var item in items)
            {
                var sItem = new JObject();
                sItem.Add("itemSeq", item.Seq);
                sItem.Add("itemCd", item.ItemCode);
                sItem.Add("itemClsCd", item.ItemClsCode);
                sItem.Add("itemNm", item.ItemName);
                sItem.Add("bcd", "");
                sItem.Add("pkgUnitCd", item.PkgUnitCode);
                sItem.Add("pkg", 0.0);
                sItem.Add("qtyUnitCd", item.QtyUnitCode);
                sItem.Add("qty", item.Quantity);
                sItem.Add("prc", item.UnitPrice);
                sItem.Add("splyAmt", item.SupplyAmount);
                sItem.Add("dcRt", item.DiscountRate);
                sItem.Add("dcAmt", item.DiscountAmount);
                sItem.Add("isrccCd", "");
                sItem.Add("isrccNm", "");
                sItem.Add("isrcRt", 0.0);
                sItem.Add("isrcAmt", 0.0);
                sItem.Add("taxTyCd", item.TaxTypeCode);
                sItem.Add("taxblAmt", item.TaxableAmount);
                sItem.Add("taxAmt", item.TaxAmount);
                sItem.Add("totAmt", item.TotalAmount);
                salesItemsArray.Add(sItem);
            }

            var salesReq = new JObject();
            salesReq.Add("tin", _tin);
            salesReq.Add("bhfId", _branchId);
            salesReq.Add("invcNo", invcNo);
            salesReq.Add("orgInvcNo", 0);
            salesReq.Add("custTin", (buyerPin != "NA") ? buyerPin : "");
            salesReq.Add("custNm", buyerName);
            salesReq.Add("salesTyCd", "N");
            salesReq.Add("rcptTyCd", "S");
            salesReq.Add("pmtTyCd", paymentCode);
            salesReq.Add("rfdRsnCd", "");
            salesReq.Add("salesSttsCd", "02");
            salesReq.Add("cfmDt", rcptDt);
            salesReq.Add("salesDt", salesDt);
            salesReq.Add("stockRlsDt", "");
            salesReq.Add("cnclReqDt", "");
            salesReq.Add("cnclDt", "");
            salesReq.Add("rfdDt", "");
            salesReq.Add("totItemCnt", (double)items.Count);
            salesReq.Add("taxblAmtA", taxblAmtA);
            salesReq.Add("taxblAmtB", taxblAmtB);
            salesReq.Add("taxblAmtC", 0.0);
            salesReq.Add("taxblAmtD", taxblAmtD);
            salesReq.Add("taxblAmtE", 0.0);
            salesReq.Add("taxRtA", 0);
            salesReq.Add("taxRtB", taxblAmtB > 0 ? 16 : 0);
            salesReq.Add("taxRtC", 0);
            salesReq.Add("taxRtD", 0);
            salesReq.Add("taxRtE", 0);
            salesReq.Add("taxAmtA", 0.0);
            salesReq.Add("taxAmtB", taxAmtB);
            salesReq.Add("taxAmtC", 0.0);
            salesReq.Add("taxAmtD", 0.0);
            salesReq.Add("taxAmtE", 0.0);
            salesReq.Add("totTaxblAmt", totalAmt);
            salesReq.Add("totTaxAmt", totTaxAmt);
            salesReq.Add("totAmt", totalAmt);
            salesReq.Add("prchrAcptcYn", "N");
            salesReq.Add("remark", remark);
            salesReq.Add("regrId", _userId);
            salesReq.Add("regrNm", _userNm);
            salesReq.Add("modrId", _userId);
            salesReq.Add("modrNm", _userNm);
            salesReq.Add("itemList", salesItemsArray);

            SaveEncryptedEnvelope(_outboxDir, filePrefix + "Sales.json", "Sales", filePrefix + "Sales", "saveTrnsSales", salesReq.ToString(Formatting.None), reqDt);

            // 2. SalesReceipt JSON
            var receiptReq = new JObject();
            receiptReq.Add("tin", _tin);
            receiptReq.Add("bhfId", _branchId);
            receiptReq.Add("invcNo", invcNo);
            receiptReq.Add("orgInvcNo", 0);
            receiptReq.Add("curRcptNo", curRcptNo);
            receiptReq.Add("totRcptNo", totRcptNo);
            receiptReq.Add("custTin", (buyerPin != "NA") ? buyerPin : "");
            receiptReq.Add("custMblNo", null);
            receiptReq.Add("rptNo", dayCount);
            receiptReq.Add("rcptPbctDt", rcptDt);
            receiptReq.Add("intrlData", rawIntrl);
            receiptReq.Add("rcptSign", rawSig);
            receiptReq.Add("jrnl", jrnl);
            receiptReq.Add("trdeNm", "");
            receiptReq.Add("adrs", "");
            receiptReq.Add("topMsg", "");
            receiptReq.Add("btmMsg", "");
            receiptReq.Add("prchrAcptcYn", "N");
            receiptReq.Add("regrId", _userId);
            receiptReq.Add("regrNm", _userNm);
            receiptReq.Add("modrId", _userId);
            receiptReq.Add("modrNm", _userNm);

            SaveEncryptedEnvelope(_outboxDir, filePrefix + "SalesReceipt.json", "SalesReceipt", filePrefix + "SalesReceipt", "saveTrnsSalesReceipt", receiptReq.ToString(Formatting.None), reqDt);

            // 3. StockIo JSON
            var stockIoItemsArray = new JArray();
            foreach (var item in items)
            {
                var ioItem = new JObject();
                ioItem.Add("itemSeq", item.Seq);
                ioItem.Add("itemCd", item.ItemCode);
                ioItem.Add("itemClsCd", item.ItemClsCode);
                ioItem.Add("itemNm", item.ItemName);
                ioItem.Add("bcd", "");
                ioItem.Add("pkgUnitCd", item.PkgUnitCode);
                ioItem.Add("pkg", 0.0);
                ioItem.Add("qtyUnitCd", item.QtyUnitCode);
                ioItem.Add("qty", item.Quantity);
                ioItem.Add("itemExprDt", "");
                ioItem.Add("prc", item.UnitPrice);
                ioItem.Add("splyAmt", item.SupplyAmount);
                ioItem.Add("totDcAmt", item.DiscountAmount);
                ioItem.Add("taxblAmt", item.TaxableAmount);
                ioItem.Add("taxTyCd", item.TaxTypeCode);
                ioItem.Add("taxAmt", item.TaxAmount);
                ioItem.Add("totAmt", item.TotalAmount);
                stockIoItemsArray.Add(ioItem);
            }

            var stockIoReq = new JObject();
            stockIoReq.Add("tin", _tin);
            stockIoReq.Add("bhfId", _branchId);
            stockIoReq.Add("sarNo", sarNo);
            stockIoReq.Add("orgSarNo", 0);
            stockIoReq.Add("regTyCd", "A");
            stockIoReq.Add("custTin", (buyerPin != "NA") ? buyerPin : "");
            stockIoReq.Add("custBhfId", "00");
            stockIoReq.Add("custNm", buyerName);
            stockIoReq.Add("sarTyCd", "11");
            stockIoReq.Add("ocrnDt", salesDt);
            stockIoReq.Add("totItemCnt", items.Count);
            stockIoReq.Add("totTaxblAmt", totalAmt);
            stockIoReq.Add("totTaxAmt", totTaxAmt);
            stockIoReq.Add("totAmt", totalAmt);
            stockIoReq.Add("remark", "");
            stockIoReq.Add("regrId", _userId);
            stockIoReq.Add("regrNm", _userNm);
            stockIoReq.Add("modrId", _userId);
            stockIoReq.Add("modrNm", _userNm);
            stockIoReq.Add("itemList", stockIoItemsArray);

            SaveEncryptedEnvelope(_outboxDir, filePrefix + "StockIo.json", "StockIo", filePrefix + "StockIo", "insertStockIO", stockIoReq.ToString(Formatting.None), reqDt);

            // 4. StockMaster JSON for each item
            int smIdx = 0;
            foreach (var item in items)
            {
                var stockMasterReq = new JObject();
                stockMasterReq.Add("tin", _tin);
                stockMasterReq.Add("bhfId", _branchId);
                stockMasterReq.Add("itemCd", item.ItemCode);
                stockMasterReq.Add("rsdQty", item.NewStock);
                stockMasterReq.Add("regrId", _userId);
                stockMasterReq.Add("regrNm", _userNm);
                stockMasterReq.Add("modrId", _userId);
                stockMasterReq.Add("modrNm", _userNm);

                string smFileName = string.Format("{0}StockMaster_{1}.json", filePrefix, smIdx++);
                SaveEncryptedEnvelope(_outboxDir, smFileName, "StockMaster", smFileName.Replace(".json", ""), "saveStockMaster", stockMasterReq.ToString(Formatting.None), reqDt);
            }
        }

        private void SaveEncryptedEnvelope(string dir, string fileName, string fileType, string recordFileName, string functionName, string jsonRequest, string requestDt)
        {
            var envelope = new JObject();
            envelope.Add("FileType", fileType);
            envelope.Add("FileName", recordFileName);
            envelope.Add("FunctionName", functionName);
            envelope.Add("JsonRequest", jsonRequest);
            envelope.Add("RequestDt", requestDt);
            envelope.Add("ResultCd", null);
            envelope.Add("ResultMsg", null);
            envelope.Add("ResultDt", null);

            string envelopeJson = envelope.ToString(Formatting.Indented);
            string encrypted = Common.AESEncrypt256(_aesPassword, envelopeJson);
            File.WriteAllText(Path.Combine(dir, fileName), encrypted, Encoding.UTF8);
        }
    }

    class Program
    {
        static void Main(string[] args)
        {
            string installDir = @"C:\eTIMS-Paypoint-Win";
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--installation-dir" && i + 1 < args.Length)
                {
                    installDir = args[i + 1];
                }
            }

            AppDomain.CurrentDomain.AssemblyResolve += (sender, resolveArgs) =>
            {
                string assemblyName = resolveArgs.Name.Split(',')[0] + ".dll";
                string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                string localDll = Path.Combine(exeDir, assemblyName);
                if (File.Exists(localDll)) return Assembly.LoadFrom(localDll);

                if (!string.IsNullOrEmpty(installDir))
                {
                    string binPath = Path.Combine(installDir, "bin");
                    string fullPath = Path.Combine(binPath, assemblyName);
                    if (File.Exists(fullPath)) return Assembly.LoadFrom(fullPath);

                    string directPath = Path.Combine(installDir, assemblyName);
                    if (File.Exists(directPath)) return Assembly.LoadFrom(directPath);
                }
                return null;
            };

            Run(args, installDir);
        }

        static void Run(string[] args, string installDir)
        {
            try
            {
                string dbPath = null;
                string outboxDir = null;
                string outputDir = null;
                string reqJson = null;

                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--json" && i + 1 < args.Length)
                    {
                        reqJson = args[i + 1];
                    }
                    else if (args[i] == "--file" && i + 1 < args.Length)
                    {
                        reqJson = File.ReadAllText(args[i + 1], Encoding.UTF8);
                    }
                    else if (args[i] == "--db-path" && i + 1 < args.Length)
                    {
                        dbPath = args[i + 1];
                    }
                    else if (args[i] == "--outbox-dir" && i + 1 < args.Length)
                    {
                        outboxDir = args[i + 1];
                    }
                    else if (args[i] == "--output-dir" && i + 1 < args.Length)
                    {
                        outputDir = args[i + 1];
                    }
                }

                if (string.IsNullOrEmpty(reqJson))
                {
                    // Read standard input if piped
                    if (Console.IsInputRedirected)
                    {
                        reqJson = Console.In.ReadToEnd();
                    }
                }

                if (string.IsNullOrEmpty(reqJson))
                {
                    var sampleReq = new InvoiceRequest();
                    sampleReq.BuyerPin = "A002257602W";
                    sampleReq.BuyerName = "Zack";
                    sampleReq.PaymentCode = "01";
                    sampleReq.Remark = "Oraforge:test";
                    sampleReq.Items = new List<InvoiceItemInput>();
                    sampleReq.Items.Add(new InvoiceItemInput
                    {
                        ItemCode = "KE-2OUXNOX-0000001",
                        Name = "Book",
                        Quantity = 1,
                        UnitPrice = 1300,
                        LineTotal = 1300,
                        TaxCode = "D"
                    });
                    reqJson = JsonConvert.SerializeObject(sampleReq);
                }

                var req = JsonConvert.DeserializeObject<InvoiceRequest>(reqJson);
                var gen = new Generator(installDir, dbPath, outboxDir, outputDir);
                var result = gen.GenerateInvoice(req);

                string outJson = JsonConvert.SerializeObject(result, Formatting.None);
                Console.WriteLine(outJson);
            }
            catch (Exception ex)
            {
                var errResult = new InvoiceResult
                {
                    Success = false,
                    Error = ex.ToString()
                };
                Console.WriteLine(JsonConvert.SerializeObject(errResult, Formatting.None));
            }
        }
    }
}
