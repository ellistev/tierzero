/* global Proxy */

class ServiceRegistryHandler {
  get(target, prop) {
    //Promise compatibility
    if (prop === 'then') return undefined;
    if (!target[prop]) throw new Error(`No service registered for "${prop}".`);
    return target[prop];
  }
  set(target, prop, value) {
    if (target[prop]) throw new Error(`Service "${prop}" already registered.`);
    if (!value) throw new Error(`Service "${prop}" can't be null or undefined.`);
    target[prop] = value;
    return true;
  }
}

const services = {};
let serviceRegistry;

export default function factory(options = {}) {
  if (options.forceNew) {
    serviceRegistry = null;
    for (const k in services) {
      delete services[k];
    }
  }
  if (!serviceRegistry) {
    serviceRegistry = new Proxy(services, new ServiceRegistryHandler());
  }
  return serviceRegistry;
}
