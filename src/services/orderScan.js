const {query}=require('../db');
function fail(message,statusCode=409){const error=new Error(message);error.statusCode=statusCode;throw error;}
async function match(value,searchOnly=false){
  const code=String(value||'').trim();
  if(!code || code.length>256)fail('Enter a tracking or order number.',400);
  // Stored GLS labels encode an 11-digit, zero-padded parcel number plus
  // their Mod-10 check digit. Keep aliases limited to a validated GLS label.
  let glsCode='';
  if(/^[0-9]{12}$/.test(code)){
    const body=code.slice(0,-1),sum=[...body].reverse().reduce((total,digit,index)=>total+Number(digit)*(index%2?1:3),0);
    if(Number(code.at(-1))===9-sum%10)glsCode=body.startsWith('0')?body.slice(1):body;
  }
  const rows=(await query(`SELECT id,vendor,channel,external_order_id,order_name,tracking_code,workflow_status,shipped,business_outcome
    FROM orders WHERE tracking_code=$1 OR external_order_id=$1 OR order_name=$1 OR tracking_url=$1 OR order_url=$1 OR (tracking_code=$2 AND $2<>'' AND (tracking_url ILIKE '%gls-group.eu%' OR label_url ILIKE '%GLS%')) ORDER BY id DESC LIMIT 3`,[code,glsCode])).rows;
  if(rows.length!==1)fail(rows.length?'Multiple orders match. Use a unique tracking number.':'No matching order.');
  return (await require('./orders').listOrders({ids:[Number(rows[0].id)],activeOnly:false}))[0];
}
async function unconfirmedDispatches(){
  return (await query(`SELECT o.id,o.vendor,o.order_name,o.external_order_id,o.channel,d.state AS marketplace_dispatch_state
      FROM orders o LEFT JOIN marketplace_dispatches d ON d.order_id=o.id
      WHERE o.dispatched_at >= now() - interval '7 days' AND o.dispatched_at <= now()
        AND (o.workflow_status='shipped' OR o.shipped=true) AND o.business_outcome='active'
        AND o.channel IN ('amazon','etsy','shopify','sashe') AND COALESCE(d.state,'') <> 'confirmed'
        AND lower(COALESCE(o.status,'')) NOT IN ('shipped','fulfilled')
        AND NOT (o.channel='etsy' AND COALESCE(o.source_payload->>'was_shipped','false')='true')
        AND NOT (o.channel='etsy' AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.source_payload->'shipments')='array' THEN o.source_payload->'shipments' ELSE '[]'::jsonb END) shipment WHERE COALESCE(shipment->>'shipment_notification_timestamp','') ~ '^[1-9][0-9]*$'))
        AND NOT (o.channel='sashe' AND COALESCE(o.source_payload->>'tracking_code','') <> '')
      ORDER BY o.dispatched_at DESC,o.id DESC`)).rows;
}
module.exports={match,unconfirmedDispatches};
