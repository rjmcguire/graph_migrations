'use strict';

import arangojs, {Database, aqlQuery} from 'arangojs';
import vertexData from './data/vertices'
import edgeData from './data/edges'
import assert from 'assert';
import GraphMigration from '../src/main'

describe('GraphMigration', () => {

  let db = arangojs({databaseName: "test", url: "http://localhost:8529"})

  let vertexLike = async (example) => {
    let aql = aqlQuery`
    FOR v IN vertices FILTER MATCHES(v, ${example}) RETURN v
    `
    let cursor = await db.query(aql)
    return cursor.all()
  }


  beforeEach(async () => {
    let vertexCollection = await db.collection('vertices')
    let edgesCollection = await db.edgeCollection('edges')
    try {
      await vertexCollection.create()
      await edgesCollection.create()
    }
    catch (e) {
      // The collection exists already
    }
    // import the test data
    await vertexCollection.import(vertexData);
    await edgesCollection.import(edgeData)
  })

  afterEach(() => db.truncate())

  it('can be created with a database name', async () => {
    let gm = new GraphMigration("test")
    assert.equal('test', gm.databaseName());
  })

  it('can be created with a database name and a url', async () => {
    let gm = new GraphMigration("test", "http://localhost:8529")
    assert.equal('test', gm.databaseName());
  })

  it("raises an error if you don't provide a database name", async () => {
    assert.throws(() => new GraphMigration());
  })

  describe('GraphMigration.redirectEdges', () => {

    let getEdgesFor = async (example, direction, edgeExample) => {
      if(typeof edgeExample == 'undefined') {
        var getEdgesAQL = aqlQuery`FOR edge IN GRAPH_EDGES("test", ${example}, {includeData: true, direction: ${direction}}) RETURN edge`
      } else {
        var getEdgesAQL = aqlQuery`FOR edge IN GRAPH_EDGES("test", ${example}, {includeData: true, direction: ${direction}, edgeExamples: [${edgeExample}]}) RETURN edge`
      }
      let cursor = await db.query(getEdgesAQL)
      return await cursor.all()
    }

    it('accepts a starting example and target', async () => {
      //scoop up Shopify and it's york office
      let shopifyAQL = aqlQuery`FOR vertex IN GRAPH_SHORTEST_PATH("test", {name: "Shopify"}, {address: "126 York Street, Ottawa, ON K1N, Canada"},{includeData: true})[*].vertices RETURN vertex`
      let result = await db.query(shopifyAQL)
      let results = await result.all()
      let shopify = results[0][0]
      let shopify_york_office = results[0][1]

      let york_office_edges_before = await getEdgesFor(shopify_york_office, "outbound", {type: "uses"})
      let shopify_edges_before = await getEdgesFor(shopify, "outbound", {type: "uses"})

      //Redirect the "uses" type edges from the office to shopify
      let gm = new GraphMigration("test")
      let vertices = await gm.redirectEdges(shopify_york_office, shopify, "test", {direction: "outbound", example: {type: "uses"}})

      let york_office_edges_after = await getEdgesFor(shopify_york_office, "outbound", {type: "uses"})
      let shopify_edges_after = await getEdgesFor(shopify, "outbound", {type: "uses"})
      assert.equal(7, york_office_edges_before.length)
      assert.equal(0, shopify_edges_before.length)
      assert.equal(0, york_office_edges_after.length)
      assert.equal(7, shopify_edges_after.length)
    })

  })

  describe('GraphMigration.allCollections', () => {

    it('returns and array of all the collections associated with the specified graph', async () => {

      let gm = new GraphMigration("test")
      let collections = await gm.allCollections("test")
      assert.deepEqual(['edges', 'vertices'], collections)
    })

  })


  describe('GraphMigration.vertexToAttribute', () => {

    it('takes a vertex id', async () => {

      let gm = new GraphMigration("test")
      let vertices = await gm.vertexToAttribute({name: "mysql"}, "test", {direction: "inbound"})
      assert.equal(4, vertices.length)
      assert.equal("mysql", vertices[0].name)
      assert.equal("office", vertices[0].type)
    })

  })

  describe('GraphMigration.attributeToVertex', () => {


    it('can reify an attribute with and inbound edge', async () => {
      //transform the test data by reifying founding_year
      let gm = new GraphMigration("test")
      await gm.attributeToVertex({founding_year: 2004}, "test", "edges", {direction: "inbound"})
      //get the new vertex
      let newVertex = await vertexLike({founding_year: 2004})
      //Can we walk inbound edges and reach shopify?
      let aql = aqlQuery`FOR v IN INBOUND ${newVertex[0]} GRAPH "test" RETURN v`
      let result = await db.query(aql)
      let reachableVertex = await result.next()
      assert.equal("Shopify", reachableVertex.name)
    })

    it('can reify an attribute and add additional attributes to the inbound edge', async () => {
      //transform the test data by reifying founding_year
      let gm = new GraphMigration("test")
      await gm.attributeToVertex({founding_year: 2004}, "test", "edges", {direction: "inbound", additional_attrs: {vertex: {}, edge: {foo: "bar"}}})
      //get the new vertex
      let newVertex = await vertexLike({founding_year: 2004})
      //Can we walk inbound edges and reach shopify?
      let aql = aqlQuery`FOR v, e IN INBOUND ${newVertex[0]} GRAPH "test" RETURN e`
      let result = await db.query(aql)
      let edge = await result.next()
      assert.equal("bar", edge.foo)
    })

    it('can reify an attribute and add additional attributes to the outbound edge', async () => {
      //transform the test data by reifying founding_year
      let gm = new GraphMigration("test")
      await gm.attributeToVertex({founding_year: 2004}, "test", "edges", {direction: "outbound", additional_attrs: {vertex: {}, edge: {foo: "bar"}}})
      //get the new vertex
      let newVertex = await vertexLike({founding_year: 2004})
      //Can we walk inbound edges and reach shopify?
      let aql = aqlQuery`FOR v, e, p IN OUTBOUND ${newVertex[0]} GRAPH "test" RETURN e`
      let result = await db.query(aql)
      let edge = await result.next()
      assert.equal("bar", edge.foo)
    })

    it('can reify an attribute and add additional attributes to the vertex', async () => {
      //transform the test data by reifying founding_year
      let gm = new GraphMigration("test")
      await gm.attributeToVertex({founding_year: 2004}, "test", "edges", {direction: "outbound", additional_attrs: {vertex: {asdf: "qwerty"}}})
      //get the new vertex
      let results = await vertexLike({asdf: "qwerty"})
      let newVertex = results[0]
      assert.equal("qwerty", newVertex.asdf)
    })

    it('does not explode when additional_attrs is not present', async () => {
      //transform the test data by reifying founding_year
      let gm = new GraphMigration("test")
      await gm.attributeToVertex({founding_year: 2004}, "test", "edges", {direction: "inbound"})
      //get the new vertex
      let newVertex = await vertexLike({founding_year: 2004})
      //Can we walk inbound edges and reach shopify?
      let aql = aqlQuery`FOR v, e, p IN INBOUND ${newVertex[0]} GRAPH "test" RETURN v`
      let result = await db.query(aql)
      let reachableVertex = await result.next()
      assert.equal("Shopify", reachableVertex.name)
    })

    it('can reify an attribute with and outbound edge', async () => {
      //transform the test data by reifying founding_year
      let gm = new GraphMigration("test")
      await gm.attributeToVertex({founding_year: 2004}, "test", "edges", {direction: "outbound"})
      //get the new vertex
      let newVertex = await vertexLike({founding_year: 2004})
      //Can we walk inbound edges and reach shopify?
      let aql = aqlQuery`FOR v, e, p IN OUTBOUND ${newVertex[0]} GRAPH "test" RETURN v`
      let result = await db.query(aql)
      let reachableVertex = await result.next()
      assert.equal("Shopify", reachableVertex.name)
    })

  })

  describe('GraphMigration.mergeVertices', () => {

    it('merges the first vertex into the second', async () => {
      let gm = new GraphMigration("test")
      let merged = await gm.mergeVertices({name: "Shopify"}, {name: "Magmic Inc"}, 'test')
      let afterAQL = aqlQuery`
      FOR vertex IN GRAPH_NEIGHBORS("test", {name: "Shopify"}, {direction: "outbound", maxDepth: 1, edgeExamples: [{type: "works_in"}], includeData: true})
        RETURN vertex

      `
      let afterCursor = await db.query(afterAQL)
      let officesAfter = await afterCursor.all()
      assert.equal(officesAfter.length, 4)
    })

  })

  describe('GraphMigration.eagerDelete', () => {

    it("deletes a vertex, it's edges and any vertices that would be orphaned by that deletion", async () => {
      let gm = new GraphMigration("test")
      let deleted = await gm.eagerDelete({name: "Shopify"}, 'test')
      let afterAQL = aqlQuery`
        LET locations = (FOR v IN vertices FILTER v.type == "location" RETURN v)
        RETURN LENGTH(locations)
      `
      let afterCursor = await db.query(afterAQL)
      let locations = await afterCursor.all()

      assert.equal(locations.length, 1)
    })

  })

  describe('GraphMigration.splitEdgeCollection', () => {


    afterEach(async () => {
      //clean up after splitCollections:
      let collections = [ 'uses', 'works_in', 'located_at', 'location', 'office', 'organization', 'technology' ]
      let length =  collections.length
      for(let i = 0; i < length; i++) {
        try{
          await db.collection(collections[i]).drop()
        } catch(e){
          //no collection no problem
        }
      }
    })

    it("creates collections for the values of an attribute and moves edges into them", async () => {
      let gm = new GraphMigration("test")
      let collections = await gm.splitEdgeCollection('type', 'edges')
      let afterCursor = await db.query(`RETURN {works_in: LENGTH(works_in), uses: LENGTH(uses), located_at: LENGTH(located_at), edges: LENGTH(edges)}`)
      let resultArray = await afterCursor.all()
      let summary = resultArray[0]
      assert.equal(summary.uses, 29)
      assert.equal(summary.works_in, 4)
      assert.equal(summary.located_at, 4)
      assert.equal(summary.edges, 0)
    })

  })

  describe('GraphMigration.splitDocumentCollection', () => {

    it("creates collections for the values of an attribute and moves edges into them", async () => {
      let gm = new GraphMigration("test")
      let collections = await gm.splitDocumentCollection('type', 'vertices', 'test')
      let afterCursor = await db.query(`RETURN {location: LENGTH(location), office: LENGTH(office), technology: LENGTH(technology), organization: LENGTH(organization), vertices: LENGTH(vertices)}`)
      let resultArray = await afterCursor.all()
      let summary = resultArray[0]
      assert.equal(summary.location, 3)
      assert.equal(summary.office, 4)
      assert.equal(summary.technology, 14)
      assert.equal(summary.vertices, 0)
    })

  })

})

