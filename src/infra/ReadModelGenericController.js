const DEFAULT_LIMIT = 1000;

// This Controller is generic so it distributed with the services in the base
export default class ReadModelGenericController {
  constructor(app, config, readRepository, logger) {
    const defaultLimitForFilter = config.defaultLimitForFilter || DEFAULT_LIMIT;

    function handleError(res, err) {
      if (err.code === 'NotFound') {
        logger.info(err);
        return res.status(404).json({message: err.message});
      }
      logger.error(err);
      res.status(500).json({message: err.message});
    }

    function getFilter(req) {
      const {filter} = req.query;
      if (!filter) {
        return {limit: defaultLimitForFilter};
      }
      if (typeof filter === 'string') {
        const parsedFilter = JSON.parse(filter);
        if (!parsedFilter.limit) parsedFilter.limit = defaultLimitForFilter;
        return parsedFilter;
      }
      if (!filter.limit) filter.limit = defaultLimitForFilter;
      return filter;
    }

    app.get('/api/v1/r/:model', async(req, res) => {
      try {
        const filter = getFilter(req);
        const result = await readRepository.findByFilter_v2(req.params.model, filter);
        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    });

    app.get('/api/v1/r/:model/findOne', async(req, res) => {
      try {
        const filter = getFilter(req);
        const where = filter.where || {};
        const result = await readRepository.findOne(req.params.model, where);
        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    });
  }
}
