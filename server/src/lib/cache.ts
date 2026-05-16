import NodeCache from 'node-cache'

// TTL: 10 minutes for Wikipedia responses
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 })

export default cache
