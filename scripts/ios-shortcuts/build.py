"""Build the two auditable, credential-free OneLedger Shortcut source files.
Sign releases with Apple's `shortcuts sign --mode anyone` before publishing.
"""
import plistlib
import uuid
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'scripts/ios-shortcuts/source'
ENDPOINT = 'https://api.oneledger.me/v1/capture'
CONFIG = 'oneledger-config.json'
VERSION = '2.0.0'
def uid(name): return str(uuid.uuid5(uuid.NAMESPACE_URL, 'https://oneledger.me/shortcuts/v2/' + name)).upper()
def ref(name, output='Text'): return {'Type':'ActionOutput','OutputUUID':uid(name),'OutputName':output}
def attachment(value): return {'Value':value,'WFSerializationType':'WFTextTokenAttachment'}
def text(value):
    if isinstance(value,str): return {'Value':{'string':value},'WFSerializationType':'WFTextTokenString'}
    return {'Value':{'string':'\ufffc','attachmentsByRange':{'{0, 1}':value}},'WFSerializationType':'WFTextTokenString'}
def fields(values): return {'Value':{'WFDictionaryFieldValueItems':[{'WFKey':text(k),'WFItemType':0,'WFValue':text(v)} for k,v in values.items()]},'WFSerializationType':'WFDictionaryFieldValue'}
def action(kind,name,**params): return {'WFWorkflowActionIdentifier':'is.workflow.actions.'+kind,'WFWorkflowActionParameters':{'UUID':uid(name),**params}}
def if_value(value,group): return action('conditional',group+'-if',WFInput={'Type':'Variable','Variable':attachment(value)},WFCondition=100,WFControlFlowMode=0,GroupingIdentifier=uid(group))
def otherwise(group): return action('conditional',group+'-else',WFControlFlowMode=1,GroupingIdentifier=uid(group))
def end(group): return action('conditional',group+'-end',WFControlFlowMode=2,GroupingIdentifier=uid(group))
def post(name,body,url=ENDPOINT,headers=None):
    return action('downloadurl',name,WFURL=text(url) if isinstance(url,dict) else url,WFHTTPMethod='POST',WFHTTPBodyType='JSON',WFJSONValues=fields(body),**({'WFHTTPHeaders':fields(headers)} if headers else {}))
def workflow(name,actions,color):
    return {'WFWorkflowName':name,'WFWorkflowClientVersion':'4711','WFWorkflowMinimumClientVersion':900,'WFWorkflowMinimumClientVersionString':'900','WFWorkflowIcon':{'WFWorkflowIconStartColor':color,'WFWorkflowIconGlyphNumber':61440},'WFWorkflowInputContentItemClasses':['WFStringContentItem','WFRichTextContentItem','WFGenericFileContentItem'],'WFWorkflowOutputContentItemClasses':[],'WFWorkflowHasOutputFallback':False,'WFWorkflowHasShortcutInputVariables':True,'WFWorkflowImportQuestions':[],'WFWorkflowTypes':[],'WFQuickActionSurfaces':[],'WFWorkflowActions':actions}
def connect():
    a=[action('gettext','pair-input',WFTextActionText=text({'Type':'ExtensionInput'})),if_value(ref('pair-input'),'has-token')]
    for i in range(6): a.append(action('number.random',f'random-{i}',WFRandomNumberMinimum=100000000,WFRandomNumberMaximum=999999999))
    a.append(action('gettext','device-secret',WFTextActionText={'Value':{'string':'pfe_'+'\ufffc'*6,'attachmentsByRange':{f'{{{4+i}, 1}}':ref(f'random-{i}','Random Number') for i in range(6)}},'WFSerializationType':'WFTextTokenString'}))
    a += [post('pair-request',{'op':'pair','pairing_token':ref('pair-input'),'device_secret':ref('device-secret'),'client_version':VERSION,'platform':'ios','device_label':'iPhone'}),action('getvalueforkey','pair-url',WFInput=attachment(ref('pair-request','Contents of URL')),WFDictionaryKey='capture_url'),if_value(ref('pair-url','Dictionary Value'),'pair-success'),action('dictionary','config',WFItems=fields({'secret':ref('device-secret'),'url':ref('pair-url','Dictionary Value')})),action('documentpicker.save','save-config',WFInput=attachment(ref('config','Dictionary')),WFAskWhereToSave=False,WFSaveFileOverwrite=True,WFFileDestinationPath=CONFIG,WFFileStorageServiceIdentifier='iCloud Drive'),action('notification','connected',WFNotificationActionBody='This iPhone is connected to OneLedger. Return to OneLedger to finish automation setup.'),otherwise('pair-success'),action('notification','pair-failed',WFNotificationActionBody='Connection failed. Return to OneLedger, get a new code, then open Connect again. Your previous connection has not been changed.'),end('pair-success'),otherwise('has-token'),action('notification','missing-code',WFNotificationActionBody='Open OneLedger → Record MoMo on iPhone → Connect this iPhone. Run Connect from there to pass a fresh code.'),end('has-token')]
    return workflow('Connect to OneLedger',a,0x33509EFF)
def capture():
    a=[action('gettext','message-input',WFTextActionText=text({'Type':'ExtensionInput'})),action('documentpicker.open','read-config',WFGetFilePath=CONFIG,WFShowFilePicker=False,WFFileErrorIfNotFound=True,WFFileStorageServiceIdentifier='iCloud Drive'),action('detect.dictionary','read-dictionary',WFInput=attachment(ref('read-config','File'))),action('getvalueforkey','read-secret',WFInput=attachment(ref('read-dictionary','Dictionary')),WFDictionaryKey='secret'),action('getvalueforkey','read-url',WFInput=attachment(ref('read-dictionary','Dictionary')),WFDictionaryKey='url'),if_value(ref('message-input'),'has-message'),post('capture-request',{'op':'capture','message':ref('message-input'),'client_version':VERSION},ref('read-url','Dictionary Value'),{'x-device-key':ref('read-secret','Dictionary Value')}),otherwise('has-message'),post('test-request',{'op':'test','client_version':VERSION},ref('read-url','Dictionary Value'),{'x-device-key':ref('read-secret','Dictionary Value')}),action('notification','test-sent',WFNotificationActionBody='Connection test sent. Return to OneLedger to check whether it arrived. This test creates no transaction.'),end('has-message')]
    return workflow('OneLedger Capture',a,0x067A4DFF)

def unified():
    """One installed shortcut: interactive pairing, silent message capture.

    Pairing always requires foreground confirmation. Message text is untrusted:
    a sender must not be able to re-pair a phone by texting a pairing token.
    """
    pair = connect()['WFWorkflowActions']
    pair[1]['WFWorkflowActionParameters'].update(WFCondition=8, WFConditionalActionString='olp_')
    pair.insert(2, action('alert','approve-pairing',
        WFAlertActionTitle='Connect this iPhone?',
        WFAlertActionMessage='Continue only if you just tapped Connect in OneLedger. Cancel if this appeared after receiving a message.',
        WFAlertActionCancelButtonShown=True))
    fallback = next(i for i,a in enumerate(pair) if a['WFWorkflowActionParameters']['UUID']==uid('has-token-else'))
    # Reuse the fixed capture protocol, with a friendly unpaired state.
    record = capture()['WFWorkflowActions'][1:]
    def reuse_input(value):
        if isinstance(value, dict): return {k: (uid('pair-input') if k == 'OutputUUID' and v == uid('message-input') else reuse_input(v)) for k,v in value.items()}
        if isinstance(value, list): return [reuse_input(v) for v in value]
        return value
    record = reuse_input(record)
    record[0]['WFWorkflowActionParameters']['WFFileErrorIfNotFound'] = False
    read = record[:1]
    rest = record[1:]
    record = read + [if_value(ref('read-config','File'),'has-config')] + rest + [
        otherwise('has-config'),
        action('notification','connect-first',WFNotificationActionBody='Open OneLedger and tap Connect this iPhone before testing this shortcut.'),
        end('has-config')]
    actions = pair[:fallback+1] + record + [end('has-token')]
    result = workflow('OneLedger Capture', actions, 0x067A4DFF)
    for a in actions:
        params = a['WFWorkflowActionParameters']
        if 'WFJSONValues' in params:
            for field in params['WFJSONValues']['Value']['WFDictionaryFieldValueItems']:
                if field['WFKey']['Value']['string']=='client_version': field['WFValue']=text('3.0.0')
    return result

if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    for name,value in [('Connect to OneLedger',connect()),('OneLedger Capture',capture())]:
        (OUT/(name+'.shortcut')).write_bytes(plistlib.dumps(value,fmt=plistlib.FMT_XML,sort_keys=False))
        print(name, len(value['WFWorkflowActions']), 'actions')

    v3 = OUT / 'v3'; v3.mkdir(exist_ok=True)
    (v3/'OneLedger Capture.shortcut').write_bytes(plistlib.dumps(unified(),fmt=plistlib.FMT_XML,sort_keys=False))
