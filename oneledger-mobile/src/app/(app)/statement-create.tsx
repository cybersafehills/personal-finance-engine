import {useCallback} from 'react';
import {Button,EmptyState,Screen,ScreenHeader,Text} from '@/components/ds';
import {useQuery} from '@/hooks/useQuery';
import {useActiveSpace} from '@/features/spaces/ActiveSpaceProvider';
import {fetchDocumentOptions} from '@/features/statements/generation';
import {StatementForm} from '@/features/statements/StatementForm';
export default function CreateStatement(){
 const {activeId}=useActiveSpace();const load=useCallback(()=>fetchDocumentOptions(),[]);const query=useQuery(load);
 return <Screen><ScreenHeader title="Create statement"/>{!query.data?<Text color="textMuted">{query.error??'Loading your accounts…'}</Text>:!query.data.ok?<EmptyState title={query.data.message} action={<Button label="Try again" onPress={query.refresh}/>}/>:!query.data.value.sources.length?<EmptyState title="No available accounts" description="Add or connect an account before creating a statement."/>:<StatementForm key={activeId} options={query.data.value}/>}</Screen>;
}
