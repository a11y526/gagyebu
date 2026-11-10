# 아이폰 단축어 '가계부 자동기록' 만들기 (예전 노션용 '카드 자동'+'지출입력'을 대신함)
# 묻는 것 없이 바로 올림: 카드 승인 문자를 그대로 서버(gb_phone_sms)에 보내고, 돌아온 한 줄을 알림으로.
#   문자 해석(금액·가게·취소 건너뛰기)과 분류(같은 가게의 예전 분류)는 서버가 함 → 문자 모양이 바뀌어도 단축어는 그대로.
# 쓰는 법: python3 tools/iphone_shortcut.py <휴대폰 열쇠> [나올 파일]
#   → 서명된 .shortcut 파일. 맥에서 열면 단축어 앱에 추가됨 (iCloud로 아이폰에도 감).
#   아이폰 자동화: 메시지 '승인' 포함 → 이 단축어 실행(입력: 메시지 내용), 즉시 실행.
# 열쇠는 단축어 파일 안에만 들어감. 저장소에 넣지 말 것.
import plistlib, subprocess, sys, uuid, os, tempfile

URL = 'https://sxejmhkevefwnpwldczt.supabase.co/rest/v1/rpc/gb_phone_sms'
PUB = 'sb_publishable_gdlN0VcGUXOPkXLSqfJn0Q_VYES-EwK'
OBJ = '￼'

def U(): return str(uuid.uuid4()).upper()
def act(i, **p): return {'WFWorkflowActionIdentifier': 'is.workflow.actions.' + i, 'WFWorkflowActionParameters': p}
def out(uid, name): return {'Value': {'OutputUUID': uid, 'Type': 'ActionOutput', 'OutputName': name}, 'WFSerializationType': 'WFTextTokenAttachment'}
def tok(att): return {'Value': {'string': OBJ, 'attachmentsByRange': {'{0, 1}': att}}, 'WFSerializationType': 'WFTextTokenString'}
def text(s): return {'Value': {'string': s}, 'WFSerializationType': 'WFTextTokenString'}
def field(k, v, t=0): return {'WFItemType': t, 'WFKey': text(k), 'WFValue': v}
def fields(*items): return {'Value': {'WFDictionaryFieldValueItems': list(items)}, 'WFSerializationType': 'WFDictionaryFieldValue'}

def build(key):
    req, say = U(), U()
    acts = [
        act('downloadurl', UUID=req, WFURL=URL, WFHTTPMethod='POST', ShowHeaders=True, WFHTTPBodyType='JSON',
            WFHTTPHeaders=fields(field('apikey', text(PUB)), field('Authorization', text('Bearer ' + PUB)),
                                 field('Content-Type', text('application/json'))),
            WFJSONValues=fields(field('p_key', text(key)), field('p_msg', tok({'Type': 'ExtensionInput'})))),
        act('getvalueforkey', UUID=say, WFDictionaryKey='say', WFInput=out(req, 'URL의 콘텐츠')),
        act('notification', WFNotificationActionTitle='가계부', WFNotificationActionBody=tok({'OutputUUID': say, 'Type': 'ActionOutput', 'OutputName': '사전 값'})),
    ]
    return {
        'WFWorkflowClientVersion': '5037.109', 'WFWorkflowMinimumClientVersion': 900, 'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconStartColor': -615917313, 'WFWorkflowIconGlyphNumber': 61440},
        'WFWorkflowTypes': ['WFWorkflowTypeShowInSearch'], 'WFWorkflowHasShortcutInputVariables': True,
        'WFWorkflowInputContentItemClasses': ['WFStringContentItem', 'WFRichTextContentItem', 'WFGenericFileContentItem'],
        'WFWorkflowImportQuestions': [], 'WFQuickActionSurfaces': [], 'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowActions': acts,
    }

if __name__ == '__main__':
    key = sys.argv[1].strip()
    if len(key) != 48: sys.exit('열쇠는 48글자예요')
    dest = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/Desktop/가계부 자동기록.shortcut')
    with tempfile.NamedTemporaryFile(suffix='.shortcut', delete=False) as f:
        plistlib.dump(build(key), f, fmt=plistlib.FMT_BINARY)
    subprocess.run(['shortcuts', 'sign', '--mode', 'anyone', '--input', f.name, '--output', dest], check=True)
    os.unlink(f.name)
    print(dest)
