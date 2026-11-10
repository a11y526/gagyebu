# 아이폰 단축어 '가계부 기록' 만들기 (예전 노션용 '카드 자동'+'지출입력'을 합쳐서 우리 가계부 서버로)
# 묻는 것 없이 바로 올림: 카드 승인 문자 → 금액·가게 꺼내서 '미분류'로 기록 (분류는 앱에서)
# 쓰는 법: python3 tools/iphone_shortcut.py <휴대폰 열쇠> [나올 파일]
#   → 서명된 .shortcut 파일. 맥에서 열면 단축어 앱에 추가됨 (iCloud로 아이폰에도 감).
# 열쇠는 단축어 파일 안에만 들어감. 저장소에 넣지 말 것.
import plistlib, subprocess, sys, uuid, os, tempfile

URL = 'https://sxejmhkevefwnpwldczt.supabase.co/rest/v1/rpc/gb_phone_add'
PUB = 'sb_publishable_gdlN0VcGUXOPkXLSqfJn0Q_VYES-EwK'
OBJ = '￼'

def U(): return str(uuid.uuid4()).upper()
def act(i, **p): return {'WFWorkflowActionIdentifier': 'is.workflow.actions.' + i, 'WFWorkflowActionParameters': p}
def out(uid, name): return {'Value': {'OutputUUID': uid, 'Type': 'ActionOutput', 'OutputName': name}, 'WFSerializationType': 'WFTextTokenAttachment'}
def tok(att): return {'Value': {'string': OBJ, 'attachmentsByRange': {'{0, 1}': att}}, 'WFSerializationType': 'WFTextTokenString'}
def text(s): return {'Value': {'string': s}, 'WFSerializationType': 'WFTextTokenString'}
def field(k, v, t=0): return {'WFItemType': t, 'WFKey': text(k), 'WFValue': v}

def build(key):
    m, first, num, pm, place, req, resp = (U() for _ in range(7))
    inp = {'Type': 'ExtensionInput'}
    def stop_if(word):
        g = U()
        return [act('conditional', GroupingIdentifier=g, WFControlFlowMode=0, WFCondition=99, WFConditionalActionString=word,
                    WFInput={'Type': 'Variable', 'Variable': {'Value': inp, 'WFSerializationType': 'WFTextTokenAttachment'}}),
                act('exit'),
                act('conditional', GroupingIdentifier=g, WFControlFlowMode=2)]
    acts = [
        # 취소·거절 문자는 넣지 않음
        *[a for w in ('취소', '거절', '실패') for a in stop_if(w)],
        # '12,300원' → 12300 (예전 '카드 자동'처럼 숫자만 넘어와도 됨)
        act('text.match', UUID=m, WFMatchTextPattern=r'[0-9,]+(?=원)|^[0-9]+$', ShowWhenRun=False, text=tok(inp)),
        act('getitemfromlist', UUID=first, WFInput=out(m, '일치')),
        act('text.replace', UUID=num, WFReplaceTextFind=',', WFInput=tok({'OutputUUID': first, 'Type': 'ActionOutput', 'OutputName': '목록의 항목'})),
        # 가게: 시각(14:22) 바로 뒤 한 줄
        act('text.match', UUID=pm, WFMatchTextPattern=r'(?<=[0-9]:[0-9]{2}\s)[^\n]+', ShowWhenRun=False, text=tok(inp)),
        act('getitemfromlist', UUID=place, WFInput=out(pm, '일치')),
        act('downloadurl', UUID=req, WFURL=URL, WFHTTPMethod='POST', ShowHeaders=True, WFHTTPBodyType='JSON',
            WFHTTPHeaders={'Value': {'WFDictionaryFieldValueItems': [
                field('apikey', text(PUB)), field('Authorization', text('Bearer ' + PUB)), field('Content-Type', text('application/json'))]},
                'WFSerializationType': 'WFDictionaryFieldValue'},
            WFJSONValues={'Value': {'WFDictionaryFieldValueItems': [
                field('p_key', text(key)),
                field('p_amt', tok({'OutputUUID': num, 'Type': 'ActionOutput', 'OutputName': '업데이트된 텍스트'}), 3),
                field('p_place', tok({'OutputUUID': place, 'Type': 'ActionOutput', 'OutputName': '목록의 항목'})),
                field('p_split', text('solo')),
                field('p_source', text('iphone'))]},
                'WFSerializationType': 'WFDictionaryFieldValue'}),
        act('gettext', UUID=resp, WFTextActionText=tok({'OutputUUID': req, 'Type': 'ActionOutput', 'OutputName': 'URL의 콘텐츠'})),
    ]
    g = U()
    acts += [
        act('conditional', GroupingIdentifier=g, WFControlFlowMode=0, WFCondition=99, WFConditionalActionString='true',
            WFInput={'Type': 'Variable', 'Variable': out(resp, '텍스트')}),
        act('notification', WFNotificationActionTitle='가계부', WFNotificationActionBody={'Value': {'string': OBJ + '원 기록됨', 'attachmentsByRange': {'{0, 1}': {'OutputUUID': num, 'Type': 'ActionOutput', 'OutputName': '업데이트된 텍스트'}}}, 'WFSerializationType': 'WFTextTokenString'}),
        act('conditional', GroupingIdentifier=g, WFControlFlowMode=1),
        act('notification', WFNotificationActionTitle='가계부 기록 못 함', WFNotificationActionBody=tok({'OutputUUID': resp, 'Type': 'ActionOutput', 'OutputName': '텍스트'})),
        act('conditional', GroupingIdentifier=g, WFControlFlowMode=2),
    ]
    return {
        'WFWorkflowClientVersion': '5037.109', 'WFWorkflowMinimumClientVersion': 900, 'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconStartColor': -615917313, 'WFWorkflowIconGlyphNumber': 61440},
        'WFWorkflowTypes': ['WFWorkflowTypeShowInSearch'], 'WFWorkflowHasShortcutInputVariables': True,
        'WFWorkflowInputContentItemClasses': ['WFStringContentItem', 'WFRichTextContentItem'],
        'WFWorkflowImportQuestions': [], 'WFQuickActionSurfaces': [], 'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowActions': acts,
        'WFWorkflowTriggers': [{'WFTriggerIdentifier': 'WFMessageTrigger', 'WFTriggerUUID': U(), 'WFTriggerSerializedParameters': {'WFMessageConditions': {
            'Value': {'WFActionParameterFilterPrefix': 1, 'WFContentPredicateBoundedDate': False, 'WFActionParameterFilterTemplates': [
                {'Operator': 1, 'Values': {'Text': '승인'}, 'Removable': False, 'Property': 'Message'}]},
            'WFSerializationType': 'WFContentPredicateTableTemplate'}}}],
    }

if __name__ == '__main__':
    key = sys.argv[1].strip()
    if len(key) != 48: sys.exit('열쇠는 48글자예요')
    dest = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/Desktop/가계부 기록.shortcut')
    with tempfile.NamedTemporaryFile(suffix='.shortcut', delete=False) as f:
        plistlib.dump(build(key), f, fmt=plistlib.FMT_BINARY)
    subprocess.run(['shortcuts', 'sign', '--mode', 'anyone', '--input', f.name, '--output', dest], check=True)
    os.unlink(f.name)
    print(dest)
