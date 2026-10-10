import json, pathlib
OUT = pathlib.Path(__file__).parent
SYN = "SYNTHETIC - FOR TESTING. Fictional people, hospital and amounts."
EXEMPT = ["pharmacy", "consumables", "implant", "diagnostics"]
ASSOC = ["nursing", "professional_fee", "ot", "procedure"]

def lines(rows):
    out = []
    for i, (date, part, cat, rate, units) in enumerate(rows, 1):
        out.append({"line_id": f"L{i:02d}", "date": date, "particulars": part, "category": cat,
                    "rate": rate, "units": units, "amount": round(rate * units, 2)})
    return out

def total(ls, pred=lambda l: True):
    return round(sum(l["amount"] for l in ls if pred(l)), 2)

def write(case):
    case["bill"]["total"] = total(case["bill"]["lines"])
    if case["settlement"]["claimed"] is None:
        case["settlement"]["claimed"] = case["bill"]["total"]
    case["settlement"]["approved"] = round(case["settlement"]["claimed"] - case["settlement"]["total_deducted"], 2)
    (OUT / f"{case['case_id']}.json").write_text(json.dumps(case, indent=2, ensure_ascii=False) + "\n")
    print(case["case_id"], "bill", case["bill"]["total"], "deducted", case["settlement"]["total_deducted"])

star_policy = {"doc_id": "star_fho_v19", "file": "data/01-FHO-Insurance-policy-wordings.pdf",
               "product": "Family Health Optima Insurance Plan", "uin": "SHAHLIP23164V072223", "version": "POL / FHO / V.19 / 2023"}

# Case A: proportionate deduction spread to exempt heads
A_rows = [
 ("2026-08-03","Deluxe room rent (inclusive of nursing)","room",8000,4),
 ("2026-08-03","Cardiologist consultation","professional_fee",2500,4),
 ("2026-08-04","Surgeon fee - PTCA","professional_fee",45000,1),
 ("2026-08-04","Anaesthetist fee","professional_fee",8000,1),
 ("2026-08-04","Cath lab / OT charges","ot",30000,1),
 ("2026-08-04","PTCA procedure charges","procedure",25000,1),
 ("2026-08-04","Drug-eluting stent","implant",39186.03,1),
 ("2026-08-04","Guide wire and balloon catheter","consumables",18500,1),
 ("2026-08-03","Pharmacy - medicines","pharmacy",21400,1),
 ("2026-08-04","Pharmacy - contrast and IV fluids","pharmacy",6200,1),
 ("2026-08-03","Echocardiography","diagnostics",3500,1),
 ("2026-08-03","Blood investigations","diagnostics",7800,1),
 ("2026-08-04","Coronary angiography imaging","diagnostics",12000,1),
 ("2026-08-03","Admission kit","non_medical",1200,1),
 ("2026-08-03","Documentation charges","non_medical",800,1),
]
A = lines(A_rows)
eligible, actual, days = 5000, 8000, 4
ratio = eligible / actual
room_diff = (actual - eligible) * days
assoc_total = total(A, lambda l: l["category"] in ASSOC)
exempt_total = total(A, lambda l: l["category"] in EXEMPT)
assoc_cut = round(assoc_total * (1 - ratio), 2)
exempt_cut = round(exempt_total * (1 - ratio), 2)
subsumed = total(A, lambda l: l["category"] == "non_medical")
A_ded = [
 {"deduction_id":"D1","label":"Room rent beyond eligibility","amount":room_diff,"line_ids":["L01"],"insurer_reason":"Room rent restricted to Rs 5,000 per day as per policy"},
 {"deduction_id":"D2","label":"Proportionate deduction - associated medical expenses","amount":assoc_cut,"line_ids":["L02","L03","L04","L05","L06"],"insurer_reason":"Proportionate deduction as per policy terms"},
 {"deduction_id":"D3","label":"Proportionate deduction - other expenses","amount":exempt_cut,"line_ids":["L07","L08","L09","L10","L11","L12","L13"],"insurer_reason":"Proportionate deduction as per policy terms"},
 {"deduction_id":"D4","label":"Non-payable items","amount":subsumed,"line_ids":["L14","L15"],"insurer_reason":"Non-payable items"},
]
write({"case_id":"case_a","title":"Room-rent cut spread to pharmacy, stent and tests","synthetic_notice":SYN,
 "policy":{**star_policy,"schedule":{"sum_insured":500000,"inception_date":"2021-06-01","eligible_room_rent_per_day":eligible}},
 "patient":{"name":"Ramesh Kalita (fictional)","age":58},
 "admission":{"hospital":"Synthetic Heart Institute, Guwahati (SYN-0001)","admitted":"2026-08-03T09:30:00","discharged":"2026-08-07T12:00:00","diagnosis":"Coronary artery disease - PTCA with one stent","room_category":"Deluxe single room (Rs 8,000/day)","cashless":True},
 "bill":{"lines":A},
 "settlement":{"claimed":None,"total_deducted":round(sum(d["amount"] for d in A_ded),2),"deductions":A_ded,"letter_text":"Claim approved with deductions: room rent beyond eligibility; proportionate deduction as per policy terms; non-payable items."},
 "timeline":[],
 "expected":[
  {"deduction_id":"D1","status":"valid","recoverable":0,"basis":["policy:room_limit_table"]},
  {"deduction_id":"D2","status":"valid","recoverable":0,"basis":["policy:proportionate_note"],"note":f"Ratio {eligible}/{actual} = {ratio}; associated expenses {assoc_total}"},
  {"deduction_id":"D3","status":"contestable","recoverable":exempt_cut,"basis":["policy:associated_expenses_definition"],"note":f"Exempt heads total {exempt_total}; policy excludes pharmacy, consumables, implants and diagnostics from associated medical expenses"},
  {"deduction_id":"D4","status":"valid","recoverable":0,"basis":["policy:subsumed_into_room_charges"],"note":"Admission kit and documentation charges are listed as subsumed into room charges"},
  {"deduction_id":"LETTER","status":"contestable","recoverable":0,"basis":["MC24-17b"],"note":"Letter does not reference specific policy terms"}
 ]})

# Case B: PED non-disclosure after 60-month moratorium (policy wording still says 8 years)
B = lines([
 ("2026-09-02","Single standard AC room","room",4500,5),
 ("2026-09-02","Nursing charges","nursing",1200,5),
 ("2026-09-03","Neurologist fees","professional_fee",3000,5),
 ("2026-09-02","MRI brain","diagnostics",9500,1),
 ("2026-09-02","Blood investigations","diagnostics",6400,1),
 ("2026-09-02","Pharmacy - medicines","pharmacy",28600,1),
 ("2026-09-03","Thrombolysis procedure","procedure",22000,1),
])
bt = total(B)
write({"case_id":"case_b","title":"Rejected for non-disclosure after 7 years of cover","synthetic_notice":SYN,
 "policy":{**star_policy,"schedule":{"sum_insured":500000,"inception_date":"2019-04-01","continuous_coverage":True,"eligible_room_rent_per_day":5000}},
 "patient":{"name":"Anjali Bora (fictional)","age":61},
 "admission":{"hospital":"Synthetic City Hospital, Guwahati (SYN-0002)","admitted":"2026-09-02T22:10:00","discharged":"2026-09-07T11:00:00","diagnosis":"Ischaemic stroke; history of hypertension","room_category":"Single standard AC room","cashless":False},
 "bill":{"lines":B},
 "settlement":{"claimed":None,"total_deducted":bt,"deductions":[{"deduction_id":"D1","label":"Claim repudiated","amount":bt,"line_ids":[l["line_id"] for l in B],"insurer_reason":"Repudiated for non-disclosure of pre-existing hypertension diagnosed in 2017, within the moratorium period of eight years as per policy condition 12"}],"letter_text":"Your claim is repudiated due to non-disclosure of pre-existing hypertension (diagnosed 2017) at proposal stage. As per policy condition 12, the moratorium period is eight continuous years, which is not completed."},
 "timeline":[],
 "expected":[{"deduction_id":"D1","status":"contestable","recoverable":bt,"basis":["MC24-13","IPR24-S3-8"],"note":"Coverage from 2019-04-01 to admission 2026-09-02 exceeds 60 months; regulation overrides the policy's eight-year wording; no fraud alleged"}]})

# Case C: control - PED waiting period genuinely not elapsed (36-month cap still not met)
C = lines([
 ("2026-08-10","Single standard AC room","room",4000,3),
 ("2026-08-10","Nursing charges","nursing",1000,3),
 ("2026-08-11","Surgeon fee","professional_fee",30000,1),
 ("2026-08-11","OT charges","ot",18000,1),
 ("2026-08-10","Pharmacy - medicines","pharmacy",12500,1),
 ("2026-08-10","Investigations","diagnostics",5200,1),
])
ct = total(C)
write({"case_id":"case_c","title":"Control: waiting period really not over","synthetic_notice":SYN,
 "policy":{**star_policy,"schedule":{"sum_insured":500000,"inception_date":"2025-01-15","declared_conditions":["Type 2 diabetes (declared and accepted)"],"eligible_room_rent_per_day":5000}},
 "patient":{"name":"Prakash Das (fictional)","age":54},
 "admission":{"hospital":"Synthetic Care Hospital, Guwahati (SYN-0003)","admitted":"2026-08-10T08:00:00","discharged":"2026-08-13T10:00:00","diagnosis":"Diabetic foot ulcer - debridement","room_category":"Single standard AC room","cashless":False},
 "bill":{"lines":C},
 "settlement":{"claimed":None,"total_deducted":ct,"deductions":[{"deduction_id":"D1","label":"Claim repudiated","amount":ct,"line_ids":[l["line_id"] for l in C],"insurer_reason":"Treatment relates to declared pre-existing diabetes; waiting period of 48 months under Excl 01 not completed"}],"letter_text":"Your claim is repudiated under Code Excl 01: treatment of pre-existing disease (diabetes) is excluded until expiry of 48 months of continuous coverage."},
 "timeline":[],
 "expected":[{"deduction_id":"D1","status":"valid","recoverable":0,"basis":["policy:excl01_ped","IPR24-PED36"],"note":"18 months of cover; even the 36-month regulatory cap has not elapsed, so the rejection stands although the policy's 48 months is reduced to 36"}]})

hdfc = {"doc_id":"hdfc_optima_secure","file":"data/myoptima-secure---cis-pww.pdf","product":"my:Optima Secure","uin":None,"version":None}

# Case D: discharge authorisation delay beyond 3 hours, extra charges deducted
D = lines([
 ("2026-07-20","Single private room","room",6000,3),
 ("2026-07-20","Nursing charges","nursing",1500,3),
 ("2026-07-21","Orthopaedic surgeon fee","professional_fee",40000,1),
 ("2026-07-21","OT charges","ot",25000,1),
 ("2026-07-20","Pharmacy - medicines","pharmacy",15800,1),
 ("2026-07-20","X-ray and investigations","diagnostics",6900,1),
 ("2026-07-23","Room retention after discharge advice (half day)","room",3000,1),
 ("2026-07-23","Nursing - retention after discharge advice","nursing",750,1),
])
retention = total(D, lambda l: l["line_id"] in ("L07","L08"))
write({"case_id":"case_d","title":"Kept waiting 5.5 hours for discharge, then charged for it","synthetic_notice":SYN,
 "policy":{**hdfc,"schedule":{"sum_insured":1000000,"inception_date":"2022-03-10"}},
 "patient":{"name":"Meena Saikia (fictional)","age":47},
 "admission":{"hospital":"Synthetic Ortho Centre, Guwahati (SYN-0004)","admitted":"2026-07-20T07:30:00","discharged":"2026-07-23T17:00:00","diagnosis":"Fracture shaft of femur - ORIF","room_category":"Single private room","cashless":True},
 "bill":{"lines":D},
 "settlement":{"claimed":None,"total_deducted":retention,"deductions":[{"deduction_id":"D1","label":"Charges beyond discharge advice","amount":retention,"line_ids":["L07","L08"],"insurer_reason":"Charges incurred after discharge advice are not payable"}],"letter_text":"Final approval granted. Deduction: charges beyond discharge advice are not payable as per policy terms."},
 "timeline":[
  {"event":"cashless_request","at":"2026-07-20T08:00:00"},{"event":"cashless_decision","at":"2026-07-20T10:15:00"},
  {"event":"discharge_request","at":"2026-07-23T11:00:00"},{"event":"final_authorisation","at":"2026-07-23T16:30:00"}],
 "expected":[
  {"deduction_id":"D1","status":"contestable","recoverable":retention,"basis":["MC24-16a","MC24-16b"],"note":"Final authorisation 5h30m after request; extra hospital charges are borne by the insurer"},
  {"deduction_id":"TAT_CASHLESS","status":"contestable","recoverable":0,"basis":["MC24-15b"],"note":"Cashless decision took 2h15m against a one-hour limit (breach recorded; no separate amount)"},
  {"deduction_id":"LETTER","status":"contestable","recoverable":0,"basis":["MC24-17b"],"note":"Letter cites 'policy terms' without a specific clause"}]})

# Case E: claim held for documents the insurer should collect itself
E = lines([
 ("2026-06-05","Twin sharing room","room",3500,4),
 ("2026-06-05","Nursing charges","nursing",900,4),
 ("2026-06-05","Physician fees","professional_fee",2000,4),
 ("2026-06-05","Pharmacy - medicines","pharmacy",17600,1),
 ("2026-06-05","Investigations","diagnostics",9800,1),
 ("2026-06-06","Dengue platelet transfusion","procedure",14000,1),
])
et = total(E)
write({"case_id":"case_e","title":"Claim stuck: 'submit indoor case papers'","synthetic_notice":SYN,
 "policy":{**hdfc,"schedule":{"sum_insured":1000000,"inception_date":"2020-11-01"}},
 "patient":{"name":"Rahul Baruah (fictional)","age":29},
 "admission":{"hospital":"Synthetic General Hospital, Guwahati (SYN-0005)","admitted":"2026-06-05T13:00:00","discharged":"2026-06-09T10:00:00","diagnosis":"Dengue fever with thrombocytopenia","room_category":"Twin sharing","cashless":True},
 "bill":{"lines":E},
 "settlement":{"claimed":None,"total_deducted":et,"deductions":[{"deduction_id":"D1","label":"Claim closed - documents pending","amount":et,"line_ids":[l["line_id"] for l in E],"insurer_reason":"Indoor case papers and pharmacy bills not submitted by the insured"}],"letter_text":"Your claim has been closed as the following documents were not submitted by you: indoor case papers, itemised pharmacy bills."},
 "timeline":[],
 "expected":[{"deduction_id":"D1","status":"contestable","recoverable":et,"basis":["MC24-17c","PPI24-B-V-1-ii"],"note":"Insurer/TPA must collect documents from the hospital after claim intimation; policyholder is not required to submit them"}]})
