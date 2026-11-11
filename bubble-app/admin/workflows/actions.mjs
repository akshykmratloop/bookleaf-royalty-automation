// Builders for workflow events and actions (Bubble's workflow JSON).
import { text } from '../expr.mjs';

export const API = {
  send: 'apiconnector2-0_default_collection.0_default_call',
  jobs: 'apiconnector2-0_default_collection.bTGNs',
};

/** actions: array -> {"0": {...}, "1": {...}}; each action gets id `${wfId}_a<i>` unless set. */
export function workflow(id, type, properties, actions, name) {
  const wf = { type, id, actions: Object.fromEntries(actions.map((a, i) => [i, { ...a, id: a.id ?? `${id}_a${i}` }])) };
  if (properties) wf.properties = properties;
  if (name) wf.name = name;
  return wf;
}

export const onClick = (id, elementId, actions, name) => workflow(id, 'ButtonClicked', { element_id: elementId }, actions, name);
export const customEvent = (id, actions) => workflow(id, 'CustomEvent', { event_name: id }, actions, id);

/** Adds "Only when" to an action. */
export const when = (action, condition) => ({ ...action, properties: { ...action.properties, condition } });

export const setState = (pageId, name, value, id) => ({ type: 'SetCustomState', id, properties: { element_id: pageId, custom_state: `custom.${name}`, value } });
export const trigger = (eventId, id) => ({ type: 'TriggerCustomEvent', id, properties: { custom_event: eventId } });
export const schedule = (eventId, delaySeconds, id) => ({ type: 'ScheduleCustom', id, properties: { custom_event: eventId, delay: delaySeconds } });
export const show = (elementId) => ({ type: 'ShowElement', properties: { element_id: elementId } });
export const hide = (elementId) => ({ type: 'HideElement', properties: { element_id: elementId } });
export const display = (elementId, dataSource) => ({ type: 'DisplayGroupData', properties: { element_id: elementId, data_source: dataSource } });
export const resetInputs = () => ({ type: 'ResetInputs' });

const fieldList = (fields) => Object.fromEntries(Object.entries(fields).map(([key, value], i) => [i, { key, value }]));

export const create = (type, fields, id) => ({ type: 'NewThing', id, properties: { thing_type: `custom.${type}`, initial_values: fieldList(fields) } });
export const change = (thing, fields, id) => ({ type: 'ChangeThing', id, properties: { to_change: thing, changes: fieldList(fields) } });

/** API Connector action: params are the call's parameter names (body_params_x / url_params_x). */
export function apiCall(type, params, id) {
  const props = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v?.type === 'TextExpression' ? v : text(v)]));
  return { type, id, properties: props };
}
